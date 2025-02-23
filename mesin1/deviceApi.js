const DigestFetchLib = require('digest-fetch').default;
const config = require('./config');

function generateSearchID() {
  const randHex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${randHex()}${randHex()}-${randHex()}-${(Math.floor(Math.random() * 0x0fff) | 0x4000)
    .toString(16)
    .padStart(4, '0')}-${(Math.floor(Math.random() * 0x3fff) | 0x8000)
    .toString(16)
    .padStart(4, '0')}-${randHex()}${randHex()}${randHex()}`;
}

// Inisialisasi global client
let client = new DigestFetchLib(config.isapi.username, config.isapi.password);

/**
 * Mengambil satu batch data (maxResults=30) dari mesin absensi
 * untuk minor tertentu, dengan offset tertentu. 
 * Mengembalikan object:
 *   { results, isMore, httpStatus }
 * - results: array data log
 * - isMore: boolean, true jika device mengembalikan "MORE"
 * - httpStatus: status HTTP (200, 401, dsb.)
 */
async function fetchOneBatch(minor, startTime, endTime, offset) {
  const url = `${config.isapi.baseUrl}/ISAPI/AccessControl/AcsEvent?format=json`;
  const maxResults = 30;
  let retryCount = 0;
  const MAX_RETRY = 3;

  while (true) {
    const searchID = generateSearchID();
    const requestData = {
      AcsEventCond: {
        searchID,
        searchResultPosition: offset,
        maxResults,
        major: 5,
        minor,
        startTime,
        endTime,
        picEnable: true,
      }
    };

    try {
      const response = await client.fetch(url, {
        method: 'POST',
        body: JSON.stringify(requestData),
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });

      if (response.status === 401) {
        console.warn(`[WARN] minor ${minor}, HTTP 401. Re-init auth?`);
        if (retryCount < MAX_RETRY) {
          client = new DigestFetchLib(config.isapi.username, config.isapi.password);
          retryCount++;
          console.log(`[INFO] Re-init digest (retry #${retryCount}), offset=${offset}`);
          continue; // ulangi request yang sama
        } else {
          console.error(`[ERROR] minor ${minor}, 401 melebihi ${MAX_RETRY} kali, hentikan batch.`);
          return { results: [], isMore: false, httpStatus: 401 };
        }
      } else if (response.status !== 200) {
        console.warn(`[WARN] minor ${minor}, HTTP Status=${response.status}, hentikan batch.`);
        return { results: [], isMore: false, httpStatus: response.status };
      }

      // status 200 => reset retryCount
      retryCount = 0;

      const data = await response.json();
      if (!data?.AcsEvent?.InfoList) {
        // Tidak ada data
        return { results: [], isMore: false, httpStatus: 200 };
      }

      const results = data.AcsEvent.InfoList;
      const isMore = (data.AcsEvent.responseStatusStrg === "MORE");
      return { results, isMore, httpStatus: 200 };

    } catch (error) {
      console.error(`[ERROR] minor ${minor}, fetchOneBatch:`, error.message);
      return { results: [], isMore: false, httpStatus: 500 };
    }
  }
}

module.exports = {
  fetchOneBatch
};
