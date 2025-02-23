const cron = require('node-cron');
const config = require('./config');
const { initDB, getLastSyncTime, bulkInsertLogs } = require('./db');
const { fetchOneBatch } = require('./deviceApi');

async function processMinor(minor, startTime, endTime, useBuffering) {
  let offset = 0;
  let fetchCount = 0;
  let bufferData = [];

  while (true) {
    const { results, isMore, httpStatus } = await fetchOneBatch(minor, startTime, endTime, offset);
    if (httpStatus !== 200 || results.length === 0) break; // Hentikan jika tidak ada data atau terjadi error

    bufferData.push(...results);
    fetchCount++;

    console.log(`- ${minor} fetch ${fetchCount} ->collect (buffer size: ${bufferData.length})`);

    if (useBuffering) {
      if (fetchCount >= config.fetchBeforeInsert) {
        // Hitung ukuran data sebelum insert
        const sizeInBytes = Buffer.byteLength(JSON.stringify(bufferData), 'utf8');
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

        console.log(`- ${minor} fetch ${fetchCount} ->bulk insert (Size: ${sizeInMB} MB, Rows: ${bufferData.length})`);
        await bulkInsertLogs(bufferData);

        bufferData = []; // Kosongkan buffer setelah insert
        fetchCount = 0;  // Reset fetch count setelah bulk insert
        console.log(`- ${minor} bulk insert selesai, buffer dikosongkan, fetchCount di-reset.`);
      }
    } else {
      console.log(`- ${minor} fetch ${fetchCount} ->bulk insert`);
      await bulkInsertLogs(results);
    }

    offset += results.length;
    if (!isMore) break;
  }

  if (useBuffering && bufferData.length > 0) {
    // Hitung ukuran data terakhir
    const sizeInBytes = Buffer.byteLength(JSON.stringify(bufferData), 'utf8');
    const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

    console.log(`- ${minor} fetch terakhir ->bulk insert (Size: ${sizeInMB} MB, Rows: ${bufferData.length})`);
    await bulkInsertLogs(bufferData);
  }
}

async function firstRunSync() {
  try {
    console.log("[INFO] Memulai FIRST RUN sinkronisasi");

    const lastSyncTime = await getLastSyncTime();
    let startTime = lastSyncTime ? formatDateMinusOneMinute(lastSyncTime) : "2025-01-01T00:00:00+07:00";
    const endTime = getLocalISOStringNoMillis();

    for (const minor of [38, 75]) {
      console.log(`+ sesi ${minor}`);
      await processMinor(minor, startTime, endTime, true);
    }

    console.log("[INFO] First run selesai. Memulai cron job.");
    startCronSync();
  } catch (err) {
    console.error(`[ERROR] firstRunSync: ${err.message}`);
  }
}

async function cronSync() {
  try {
    const lastSyncTime = await getLastSyncTime();
    let startTime = lastSyncTime ? formatDateMinusOneMinute(lastSyncTime) : getLocalISOStringNoMillis();
    const endTime = getLocalISOStringNoMillis();

    for (const minor of [38, 75]) {
      console.log(`+ sesi ${minor} (cron)`);
      await processMinor(minor, startTime, endTime, false);
    }
  } catch (err) {
    console.error(`[ERROR] cronSync: ${err.message}`);
  }
}

function startCronSync() {
  cron.schedule(config.schedule, cronSync);
}

async function main() {
  await initDB();
  await firstRunSync();
}

main().catch(err => console.error(`[ERROR] main: ${err.message}`));

function formatDateMinusOneMinute(dbTimeString) {
  const dateObj = new Date(dbTimeString);
  dateObj.setMinutes(dateObj.getMinutes() - 1);
  return getLocalISOStringNoMillis(dateObj);
}

function getLocalISOStringNoMillis(dateObj = new Date()) {
  const pad = (n) => n.toString().padStart(2, '0');
  return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}T${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:${pad(dateObj.getSeconds())}+07:00`;
}
