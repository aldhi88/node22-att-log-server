require('dotenv').config();

module.exports = {
  isapi: {
    baseUrl: process.env.ISAPI_BASE_URL,
    username: process.env.ISAPI_USERNAME,
    password: process.env.ISAPI_PASSWORD
  },
  db: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  },
  schedule: process.env.SCHEDULE_INTERVAL || '*/1 * * * *',
  fetchBeforeInsert: process.env.FETCH_BEFORE_INSERT,
  machineCode: parseInt(process.env.MACHINE_CODE, 10) || 0 // Default 0 jika tidak diatur
};
