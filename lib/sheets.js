/* =====================================================   lib/sheets.js — akses baca/tulis ke Google Sheets sebagai
   "database" riwayat assessment.

   Struktur sheet (tab bernama sesuai SHEET_NAME, default "Assessments"):
   Baris 1 = header:
     A: ID | B: Nama | C: Paspor | D: NegaraTujuan | E: TanggalPenilaian
     | F: TingkatRisiko | G: UpdatedAt | H: DataJSON

   Kolom H (DataJSON) menyimpan seluruh isi form (cover + 4 dimensi +
   kesimpulan) sebagai satu JSON string, supaya nambah field baru di
   form nanti tidak perlu migrasi kolom sheet.
   ============================================================ */
const { google } = require('googleapis');
const crypto = require('crypto');

const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || 'Assessments';
const HEADER = ['ID', 'Nama', 'Paspor', 'NegaraTujuan', 'TanggalPenilaian', 'TingkatRisiko', 'UpdatedAt', 'DataJSON'];

let sheetsClientPromise = null;

function assertConfigured() {
  if (!SHEET_ID) {
    throw new Error('SHEET_ID belum diisi di file .env. Lihat README bagian setup Google Sheets.');
  }
}

async function getSheetsClient() {
  if (!sheetsClientPromise) {
    sheetsClientPromise = (async () => {
      const authOptions = { scopes: ['https://www.googleapis.com/auth/spreadsheets'] };

      if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        try {
          authOptions.credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        } catch (e) {
          throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON tidak valid JSON: ' + e.message);
        }
      }

      const auth = new google.auth.GoogleAuth(authOptions);
      const client = await auth.getClient();
      return google.sheets({ version: 'v4', auth: client });
    })().catch(err => {
      sheetsClientPromise = null;
      throw new Error('Gagal autentikasi ke Google Sheets: ' + err.message + ' - cek kredensial dan pastikan sheet sudah di-share ke email service account.');
    });
  }
  return sheetsClientPromise;
}

async function ensureHeader(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A1:H1`
  });
  const row = (res.data.values && res.data.values[0]) || [];
  const hasHeader = HEADER.every((h, i) => row[i] === h);
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:H1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER] }
    });
  }
}

async function getAllRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:H`
  });
  return res.data.values || [];
}

function rowToSummary(row) {
  return {
    id: row[0] || '',
    nama: row[1] || '',
    paspor: row[2] || '',
    negara: row[3] || '',
    tanggal: row[4] || '',
    risiko: row[5] || '',
    updatedAt: row[6] || ''
  };
}

async function listAssessments() {
  assertConfigured();
  const sheets = await getSheetsClient();
  await ensureHeader(sheets);
  const rows = await getAllRows(sheets);
  return rows
    .filter(r => r[0])
    .map(rowToSummary)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function getAssessment(id) {
  assertConfigured();
  const sheets = await getSheetsClient();
  const target = String(id || '').trim();

  const attempts = 3;
  const delaysMs = [0, 300, 700];
  let rows = [];

  for (let i = 0; i < attempts; i++) {
    if (delaysMs[i]) await sleep(delaysMs[i]);

    rows = await getAllRows(sheets);
    const row = rows.find(r => String(r[0] || '').trim() === target);

    if (row) {
      try {
        return JSON.parse(row[7] || '{}');
      } catch (e) {
        throw new Error('Data JSON di sheet untuk ID ' + id + ' rusak/tidak valid.');
      }
    }
  }

  console.warn('[SHEETS] getAssessment: ID tidak ditemukan setelah retry.', {
    id: target,
    totalRows: rows.length,
    knownIds: rows.map(r => String(r[0] || '').trim()).filter(Boolean)
  });

  return null;
}

async function findRowNumberById(sheets, id) {
  const rows = await getAllRows(sheets);
  const target = String(id || '').trim();
  const idx = rows.findIndex(r => String(r[0] || '').trim() === target);
  if (idx === -1) return -1;
  return idx + 2;
}

async function upsertAssessment(id, state) {
  assertConfigured();
  const sheets = await getSheetsClient();
  await ensureHeader(sheets);

  const c = state.cover || {};
  const k = state.kesimpulan || {};
  const updatedAt = new Date().toISOString();
  const finalId = id || crypto.randomUUID();

  const rowValues = [
    finalId, c.nama || '', c.paspor || '', c.negara || '',
    c.tanggal || '', k.risiko || '', updatedAt, JSON.stringify(state)
  ];

  const existingRow = id ? await findRowNumberById(sheets, id) : -1;

  if (existingRow !== -1) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A${existingRow}:H${existingRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] }
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A2:H2`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowValues] }
    });
  }
  return { id: finalId };
}

async function getSheetGid(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`Tab/sheet "${SHEET_NAME}" tidak ditemukan di spreadsheet ini.`);
  return sheet.properties.sheetId;
}

async function deleteAssessment(id) {
  assertConfigured();
  const sheets = await getSheetsClient();
  const rowNumber = await findRowNumberById(sheets, id);
  if (rowNumber === -1) return false;
  const gid = await getSheetGid(sheets);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: gid,
            dimension: 'ROWS',
            startIndex: rowNumber - 1, // 0-based
            endIndex: rowNumber
          }
        }
      }]
    }
  });
  return true;
}

module.exports = { listAssessments, getAssessment, upsertAssessment, deleteAssessment };
