require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const sheets = require('./lib/sheets');
const pdf = require('./lib/pdf');

const PORT = process.env.PORT || 3000;
// Di Vercel, VERCEL_URL disediakan otomatis oleh platform (tanpa https://),
// dipakai Puppeteer untuk membuka print.html dari server yang sama.
const BASE_URL = process.env.BASE_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`);

const app = express();
app.use(express.json({ limit: '15mb' })); // foto base64 bisa lumayan besar

app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------
   Token store sementara (in-memory) — jembatan antara "Cetak PDF"
   di browser dan halaman print.html yang dibuka headless oleh
   Puppeteer. Token cuma hidup beberapa menit, tidak perlu database.
------------------------------------------------------------ */
const renderTokens = new Map(); // token -> { state, createdAt }
const TOKEN_TTL_MS = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of renderTokens) {
    if (now - entry.createdAt > TOKEN_TTL_MS) renderTokens.delete(token);
  }
}, 5 * 60 * 1000).unref();

app.post('/api/render-token', (req, res) => {
  const state = req.body;
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Body harus berupa state JSON.' });
  }
  const token = crypto.randomUUID();
  renderTokens.set(token, { state, createdAt: Date.now() });
  res.json({ token });
});

app.get('/api/render-data/:token', (req, res) => {
  const entry = renderTokens.get(req.params.token);
  if (!entry) return res.status(404).json({ error: 'Token tidak ditemukan atau sudah kedaluwarsa.' });
  res.json(entry.state);
});

/* ------------------------------------------------------------
   Cetak PDF — Vercel-safe: state dikirim langsung di body POST,
   tidak bergantung pada token yang disimpan di memory (yang tidak
   bisa diandalkan lintas-invocation di serverless).
------------------------------------------------------------ */
app.post('/api/pdf', async (req, res) => {
  const state = req.body;
  if (!state || typeof state !== 'object') {
    return res.status(400).json({ error: 'Body harus berupa state JSON.' });
  }
  try {
    const buffer = await pdf.renderPdfFromState(state, BASE_URL);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="WEPOSE-Profile-Assessment.pdf"');
    res.send(buffer);
  } catch (err) {
    console.error('[PDF ERROR]', err);
    res.status(500).send('Gagal membuat PDF: ' + err.message);
  }
});

/* ------------------------------------------------------------
   Riwayat / Google Sheets
------------------------------------------------------------ */
app.get('/api/assessments', async (req, res) => {
  try {
    const rows = await sheets.listAssessments();
    res.json(rows);
  } catch (err) {
    console.error('[SHEETS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/assessments/:id', async (req, res) => {
  try {
    const state = await sheets.getAssessment(req.params.id);
    if (!state) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    res.json(state);
  } catch (err) {
    console.error('[SHEETS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assessments', async (req, res) => {
  try {
    const { id, state } = req.body || {};
    if (!state || typeof state !== 'object') {
      return res.status(400).json({ error: 'Body harus berisi { id, state }.' });
    }
    const result = await sheets.upsertAssessment(id || null, state);
    res.json(result);
  } catch (err) {
    console.error('[SHEETS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assessments/:id', async (req, res) => {
  try {
    const ok = await sheets.deleteAssessment(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Data tidak ditemukan.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[SHEETS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// Jangan panggil app.listen() saat berjalan sebagai Vercel Serverless
// Function — Vercel yang akan memanggil app(req, res) langsung.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`WEPOSE Profile Assessment app jalan di ${BASE_URL}`);
  });

  process.on('SIGINT', async () => { await pdf.shutdown(); process.exit(0); });
  process.on('SIGTERM', async () => { await pdf.shutdown(); process.exit(0); });
}

module.exports = app;
