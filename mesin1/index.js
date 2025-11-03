const config = require('./config');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = config.tlsRejectUnauthorized ? "1" : "0";

const cron = require('node-cron');
const fs = require('fs');
const { fetchOneBatch } = require('./deviceApi');
const axios = require('axios');
const moment = require('moment');

const lastSyncFile = './last_time_index.txt';

// Fungsi untuk membaca lastSyncTime dari file
function getLastSyncTimeFromFile() {
  if (fs.existsSync(lastSyncFile)) {
    return fs.readFileSync(lastSyncFile, 'utf8').trim();
  }
  return null;
}

// Fungsi untuk menyimpan lastSyncTime ke file dengan pengecekan
function saveLastSyncTime(time) {
  try {
    // Lewati jika kosong atau null
    if (!time || /^null$/i.test(time)) {
      console.warn("[WARN] lastSyncTime tidak valid, tidak disimpan:", time);
      return;
    }

    // Pastikan format waktu valid (mis. 2025-10-24T23:27:13+07:00)
    const mNew = moment(time, moment.ISO_8601, true);
    if (!mNew.isValid()) {
      console.warn("[WARN] Format waktu tidak valid, abaikan:", time);
      return;
    }

    const lastTimeFromFile = getLastSyncTimeFromFile();
    if (lastTimeFromFile && moment(mNew).isBefore(moment(lastTimeFromFile))) {
      console.log(`[INFO] Waktu baru (${time}) lebih lama dari file (${lastTimeFromFile}), abaikan.`);
      return;
    }

    // Simpan waktu (format sesuai permintaan)
    const normalized = mNew.format("YYYY-MM-DDTHH:mm:ssZ");
    fs.writeFileSync(lastSyncFile, normalized, "utf8");
    console.log(`[INFO] Last sync time disimpan: ${normalized}`);
  } catch (error) {
    console.error(`[ERROR] Gagal menyimpan lastSyncTime: ${error.message}`);
  }
}



// Fungsi untuk mendapatkan lastSyncTime dari API jika file tidak ada
async function getLastSyncTime() {
  const lastTimeFromFile = getLastSyncTimeFromFile();
  if (lastTimeFromFile) {
    return lastTimeFromFile;
  }

  try {
    const response = await axios.get(`${config.apiBaseUrl}/log/attendance/get-lastest-time/${config.machineCode}`, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": config.apiSecretKey
      }
    });

    if ((response.status === 200 || response.status === 201) && response.data.lastSyncTime) {
      saveLastSyncTime(response.data.lastSyncTime);
      return response.data.lastSyncTime;
    }
  } catch (error) {
    console.error("[ERROR] Gagal mengambil lastSyncTime dari API:", error.message);
  }

  return null;
}

// Fungsi untuk mengirimkan data log ke API
async function sendLogsToAPI(logs) {
  console.log(`[DEBUG] sendLogsToAPI dipanggil, jumlah logs: ${logs.length}`);

  if (!logs.length) {
    console.warn("[WARN] Tidak ada logs yang dikirim ke API.");
    return;
  }

  const payload = {
    attendances: logs.map(event => ({
      data_employee_id: parseInt(event.employeeNoString, 10) || null,
      master_machine_id: config.machineCode,
      master_minor_id: event.minor ?? null,
      name: event.name ?? null,
      time: moment(event.time).format("YYYY-MM-DD HH:mm:ss"),
      created_at: moment().format("YYYY-MM-DD HH:mm:ss"),
      updated_at: moment().format("YYYY-MM-DD HH:mm:ss")
    }))
  };

  try {
    const response = await axios.post(`${config.apiBaseUrl}/log/attendance/store`, payload, {
      headers: {
        Accept: "application/json",
        "X-API-KEY": config.apiSecretKey
      }
    });

    if (response.status === 200 || response.status === 201) {
      console.log("[INFO] Data berhasil dikirim ke API.");
      const lastTime = logs[logs.length - 1]?.time || null;
      if (lastTime) {
        saveLastSyncTime(lastTime);
      } else {
        console.warn("[WARN] Tidak ada waktu terakhir yang bisa disimpan.");
      }
    }
  } catch (error) {
    console.error("[ERROR] Gagal mengirim data ke API:", error.response?.data || error.message);
  }
}

// Proses pengambilan data per minor
async function processMinor(minor, startTime, endTime, useBuffering) {
  let offset = 0;
  let fetchCount = 0;
  let bufferData = [];

  while (true) {
    const { results, isMore, httpStatus } = await fetchOneBatch(minor, startTime, endTime, offset);
    if (httpStatus !== 200 || results.length === 0) {
      console.warn(`[WARN] Minor ${minor}: fetchOneBatch gagal atau tidak ada data.`);
      break;
    }

    // Hapus data pertama jika memiliki time yang sama dengan lastSyncTime
    if (results.length > 0 && results[0].time === startTime) {
      console.log(`[INFO] Menghapus duplikasi log dengan time: ${startTime}`);
      results.shift();  // Hapus data pertama
    }

    bufferData.push(...results);
    fetchCount++;

    console.log(`- ${minor} fetch ${fetchCount} ->collect (buffer size: ${bufferData.length})`);

    if (useBuffering) {
      if (fetchCount >= config.fetchBeforeInsert) {
        console.log(`- ${minor} fetch ${fetchCount} ->bulk insert (Rows: ${bufferData.length})`);
        await sendLogsToAPI(bufferData);
        bufferData = [];
        fetchCount = 0;
      }
    } else {
      console.log(`- ${minor} fetch ${fetchCount} ->bulk insert`);
      await sendLogsToAPI(results);
    }

    offset += results.length;
    if (!isMore) break;
  }

  if (useBuffering && bufferData.length > 0) {
    console.log(`- ${minor} last fetch ->bulk insert (Rows: ${bufferData.length})`);
    await sendLogsToAPI(bufferData);
  }
}

// Sinkronisasi awal saat aplikasi pertama kali dijalankan
async function firstRunSync() {
  try {
    console.log("[INFO] Memulai FIRST RUN sinkronisasi");

    const lastSyncTime = await getLastSyncTime();
    let startTime = lastSyncTime || config.defaultStartTime;;
    const endTime = moment().format("YYYY-MM-DDTHH:mm:ss+07:00");

    for (const minor of config.minorValues) {
      console.log(`+ session ${minor}`);
      await processMinor(minor, startTime, endTime, true);
    }

    console.log("[INFO] First run selesai. Memulai cron job.");
    startCronSync();
  } catch (err) {
    console.error(`[ERROR] firstRunSync: ${err.message}`);
  }
}

// Sinkronisasi berkala dengan cron job
async function cronSync() {
  try {
    const lastSyncTime = await getLastSyncTime();
    let startTime = lastSyncTime || moment().format("YYYY-MM-DDTHH:mm:ss+07:00");
    const endTime = moment().format("YYYY-MM-DDTHH:mm:ss+07:00");

    for (const minor of config.minorValues) {
      console.log(`+ session ${minor} (cron)`);
      await processMinor(minor, startTime, endTime, false);
    }
  } catch (err) {
    console.error(`[ERROR] cronSync: ${err.message}`);
  }
}


// Memulai cron job
function startCronSync() {
  cron.schedule(config.schedule, cronSync);
}

// Menjalankan aplikasi
async function main() {
  await firstRunSync();
}

main().catch(err => console.error(`[ERROR] main: ${err.message}`));
