const fs = require('fs');
const mysql = require('mysql2/promise');
const config = require('./config');

let pool;
const lastSyncFile = './last_time_index.txt'; // File untuk menyimpan lastSyncTime

async function initDB() {
  pool = mysql.createPool({
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  await createLogAbsensiTable();
}

async function createLogAbsensiTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS log_absensi (
      id INT AUTO_INCREMENT PRIMARY KEY,
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      machineCode INT NOT NULL,
      serialNo INT NULL,
      major INT NULL,
      minor INT NULL,
      time DATETIME NULL,
      name VARCHAR(255) NULL,
      employeeNoString VARCHAR(255) NULL,
      currentVerifyMode VARCHAR(255) NULL,
      pictureURL VARCHAR(255) NULL,
      UNIQUE KEY unique_event (machineCode, serialNo, time)
    )
  `;

  try {
    await pool.execute(createTableQuery);
    console.log("Tabel log_absensi sudah diperbarui dengan struktur baru.");
  } catch (error) {
    console.error("Error membuat tabel log_absensi:", error.message);
    throw error;
  }
}

// Fungsi untuk menyimpan lastSyncTime ke file
function saveLastSyncTime(time) {
  fs.writeFileSync(lastSyncFile, time, 'utf8');
}

// Fungsi untuk membaca lastSyncTime dari file
function getLastSyncTimeFromFile() {
  if (fs.existsSync(lastSyncFile)) {
    return fs.readFileSync(lastSyncFile, 'utf8').trim();
  }
  return null;
}

// Fallback: Ambil lastSyncTime dari database jika file tidak ada
async function getLastSyncTime() {
  try {
    const [rows] = await pool.execute(
      "SELECT MAX(time) as maxTime FROM log_absensi WHERE machineCode = ?",
      [config.machineCode]
    );
    return rows[0].maxTime;
  } catch (error) {
    console.error("Error mengambil last sync time:", error.message);
    return null;
  }
}

// Bulk insert data ke database
async function bulkInsertLogs(logs) {
  if (!logs.length) return;

  const query = `
    INSERT IGNORE INTO log_absensi (
      machineCode, 
      serialNo, 
      major, 
      minor, 
      time, 
      name,
      employeeNoString,
      currentVerifyMode, 
      pictureURL
    ) VALUES ?
  `;

  const values = logs.map(event => [
    config.machineCode,
    event.serialNo ?? null,
    event.major ?? null,
    event.minor ?? null,
    event.time ? new Date(event.time) : null,
    event.name ?? null,
    event.employeeNoString ?? null,
    event.currentVerifyMode ?? null,
    event.pictureURL ?? null
  ]);

  try {
    await pool.query(query, [values]);

    // Update lastSyncTime di file setelah insert berhasil
    const lastTime = logs[logs.length - 1].time; // Ambil waktu terakhir dari batch
    saveLastSyncTime(lastTime);
    console.log(`[INFO] Last sync time updated: ${lastTime}`);
  } catch (error) {
    console.error("Error saat bulk insert:", error.message);
  }
}

module.exports = {
  initDB,
  getLastSyncTime,
  getLastSyncTimeFromFile,
  bulkInsertLogs
};
