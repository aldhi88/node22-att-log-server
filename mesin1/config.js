require('dotenv').config();

module.exports = {
  isapi: {
    baseUrl: process.env.ISAPI_BASE_URL,
    username: process.env.ISAPI_USERNAME,
    password: process.env.ISAPI_PASSWORD
  },
  schedule: process.env.SCHEDULE_INTERVAL || '*/1 * * * *',
  fetchBeforeInsert: process.env.FETCH_BEFORE_INSERT,
  machineCode: parseInt(process.env.MACHINE_CODE, 10) || 1,
  minorValues: process.env.MINOR_VALUES.split(',').map(Number),
  apiBaseUrl: process.env.API_BASE_URL, 
  apiSecretKey: process.env.API_SECRET_KEY,
  defaultStartTime: process.env.DEFAULT_START_TIME || "2025-03-01T00:00:00+07:00",
  tlsRejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED === "1",
};
