# WEPOSE Profile Assessment Builder — Node.js + Google Sheets

App form + live preview untuk Profile Assessment Report WEPOSE, dengan:

- **Backend Node.js/Express**, data riwayat disimpan di **Google Sheets**.
- **Riwayat**: setiap assessment yang disimpan bisa dimuat ulang ke form kapan saja.
- **PDF = Preview, dijamin identik.** Preview di layar dan file PDF sama-sama
  di-generate dari satu file `public/js/report.js` (mesin render tunggal).
  PDF dibuat di server pakai **Puppeteer** (Chrome headless) yang membuka
  halaman `print.html`, bukan lewat dialog "Print" bawaan browser — jadi
  tidak ada variasi margin/scale antar-browser/OS seperti sebelumnya.

---

## 1. Struktur folder

```
wepose-app/
  server.js              # Express app + routing API
  lib/
    sheets.js             # baca/tulis Google Sheets (riwayat)
    pdf.js                 # generate PDF via Puppeteer
  public/
    index.html             # form + live preview (yang dibuka user)
    print.html              # halaman "polos" yang di-render Puppeteer -> PDF
    css/
      app.css                # styling form/UI builder
      report.css              # styling halaman laporan (dipakai preview & PDF)
    js/
      report.js                # ENGINE render laporan (state -> HTML), dipakai index.html & print.html
      app-client.js             # logic form: state, riwayat, simpan, cetak PDF
  credentials/
    service-account.json    # (kamu buat sendiri, lihat langkah 3)
  .env                     # (kamu buat dari .env.example)
```

---

## 2. Instalasi

Butuh **Node.js 18+**.

```bash
cd wepose-app
npm install
```

`npm install` otomatis mengunduh Chromium untuk Puppeteer (~200-300MB),
pastikan koneksi internet lancar saat install pertama kali.

---

## 3. Setup Google Sheets (backend riwayat)

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat project baru (atau pakai yang sudah ada).
2. Aktifkan **Google Sheets API**: menu *APIs & Services → Library* → cari "Google Sheets API" → Enable.
3. Buat **Service Account**: *APIs & Services → Credentials → Create Credentials → Service Account*.
   Beri nama bebas (mis. `wepose-sheets-bot`), lanjut sampai selesai.
4. Buka service account yang baru dibuat → tab **Keys** → **Add Key → Create new key → JSON**.
   File JSON akan otomatis terdownload.
5. Rename file itu jadi `service-account.json` dan taruh di folder `credentials/`.
6. Buka file JSON tersebut, salin nilai `client_email` (formatnya seperti
   `wepose-sheets-bot@xxxxx.iam.gserviceaccount.com`).
7. Buat **Google Sheet baru** di Google Drive kamu. Rename tab pertama jadi
   `Assessments` (atau nama lain, asal disamakan dengan `SHEET_NAME` di `.env`).
   Header kolom akan dibuat **otomatis** oleh app saat pertama kali dipakai,
   tidak perlu diisi manual.
8. Klik **Share** di Sheet tersebut → tempel email service account (poin 6)
   → beri akses **Editor** → Send.
9. Ambil **Sheet ID** dari URL sheet:
   `https://docs.google.com/spreadsheets/d/`**`INI_SHEET_ID_NYA`**`/edit`

---

## 4. Konfigurasi `.env`

```bash
cp .env.example .env
```

Isi `.env`:

```
PORT=3000
SHEET_ID=<sheet id dari langkah 3.9>
SHEET_NAME=Assessments
GOOGLE_APPLICATION_CREDENTIALS=./credentials/service-account.json
BASE_URL=http://localhost:3000
```

---

## 5. Jalankan

```bash
npm start
```

Buka **http://localhost:3000**.

- **Isi Contoh** → mengisi form dengan data contoh (termasuk contoh dimensi
  Dokumen Pekerjaan asli).
- **Simpan** → menyimpan assessment saat ini ke Google Sheets (create/update).
- **Riwayat Tersimpan** (accordion paling atas) → daftar assessment yang
  pernah disimpan, tombol **Muat** untuk membuka kembali ke form, **Hapus**
  untuk menghapus dari sheet.
- **Cetak / Unduh PDF** → server membuat PDF (Puppeteer) dan langsung
  mengunduhnya sebagai file.

---

## 6. Kenapa PDF dijamin sama dengan preview?

`public/js/report.js` adalah **satu-satunya** tempat logic "data → HTML
halaman laporan" ditulis. Baik preview di `index.html` maupun proses PDF
di server memanggil fungsi yang **sama persis**:

```
index.html  → buildStateFromForm() → WeposeReport.renderAllPagesHTML(state)  → tampil di layar
Cetak PDF   → state dikirim ke server → print.html memuat state yang sama
            → WeposeReport.renderAllPagesHTML(state) → Puppeteer screenshot ke PDF
```

Jadi kalau ada yang terlihat aneh di preview, itu juga yang akan muncul di
PDF — dan sebaliknya, kalau preview sudah rapi, PDF-nya pasti rapi juga.
Tidak ada lagi ketergantungan pada setting print browser (margin, scale,
"fit to page", dll) karena PDF dibuat langsung dari Chromium headless
dengan ukuran `@page { size: A4; margin: 0 }` yang sudah didefinisikan di
`report.css`.

---

## 7. Nambah field baru nanti

- Field baru di form → tambahkan di `public/index.html` (tag `<input>`/`<textarea>`
  baru dengan `id` unik).
- Baca/tulis dari form → update `buildStateFromForm()` dan `loadStateToForm()`
  di `public/js/app-client.js`.
- Tampilan di halaman laporan → update template terkait (`coverPageHTML`,
  `dimPageHTML`, atau `kesimpulanPageHTML`) di `public/js/report.js`.
- Kolom sheet **tidak perlu diubah** — semua field otomatis ikut tersimpan
  karena disimpan sebagai satu JSON di kolom `DataJSON`.

---

## 8. Deploy ke Vercel

Project ini sudah disesuaikan supaya bisa jalan sebagai Vercel Serverless
Function (lihat `api/[...all].js` dan `vercel.json`). Yang perlu diperhatikan:

### 8.1 Push ke GitHub

```bash
git init
git add .
git commit -m "WEPOSE Profile Assessment - ready for Vercel"
git branch -M main
git remote add origin <url-repo-github-kamu>
git push -u origin main
```

Pastikan folder `credentials/` dan file `.env` **tidak ikut ter-commit**
(sudah dicegah oleh `.gitignore`).

### 8.2 Import project di Vercel

1. Buka vercel.com -> **Add New -> Project** -> pilih repo GitHub kamu.
2. Framework preset: biarkan **"Other"** (project ini bukan Next.js/dst,
   cukup Node + Express).
3. Sebelum klik Deploy, isi **Environment Variables**:

   | Key | Value |
   |---|---|
   | `SHEET_ID` | ID Google Sheet kamu (lihat bagian 3) |
   | `SHEET_NAME` | `Assessments` (atau nama tab kamu) |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Isi seluruh file `service-account.json` sebagai satu baris JSON (buka file-nya, copy semua isinya, tempel di sini) |

   `BASE_URL` tidak perlu diisi - otomatis dideteksi dari domain Vercel.

4. Klik **Deploy**.

### 8.3 Hal-hal penting soal Puppeteer di Vercel

- Project ini pakai `puppeteer-core` + `@sparticuz/chromium` (Chromium versi
  ringkas khusus serverless) saat berjalan di Vercel - bukan `puppeteer`
  biasa yang berat (~300MB), karena limit ukuran function di Vercel adalah
  50MB. Lokal tetap pakai `puppeteer` biasa (lihat `devDependencies`).
- `vercel.json` sudah mengatur `maxDuration: 60` detik dan memory 1536MB
  untuk function `/api/*`, karena boot Chromium + render PDF butuh waktu
  lebih dari limit default (10 detik). Catatan: paket Vercel Hobby
  membatasi maksimum durasi function di 60 detik; kalau proses generate PDF
  ternyata masih sering timeout, pertimbangkan upgrade ke paket Pro
  (bisa sampai beberapa menit) atau aktifkan Fluid Compute.
- Cold start pertama (function baru "bangun") biasanya lebih lambat
  ketimbang running di lokal - ini normal untuk Puppeteer di serverless.
- Kalau nanti muncul error ukuran function melebihi limit 50MB, ganti
  `@sparticuz/chromium` dengan `@sparticuz/chromium-min` (butuh hosting
  file Chromium terpisah - lihat dokumentasi paketnya di npm).

### 8.4 Batas ukuran body request

Vercel Serverless Functions membatasi ukuran body request (biasanya sekitar
4.5MB), lebih kecil dari limit `15mb` yang di-set di `server.js` untuk
lokal. Kalau foto yang di-upload di form cukup besar sehingga total payload
JSON-nya melebihi ~4.5MB, request bisa ditolak Vercel. Kalau ini terjadi,
kompres/resize foto di sisi klien dulu sebelum dikirim (mis. turunkan
resolusi/quality saat convert ke base64) atau upload foto ke storage
terpisah (Vercel Blob, dsb.) dan kirim URL-nya saja alih-alih base64.

### 8.5 Deploy di platform lain (VPS/Docker)

Kalau ternyata memilih VPS/Docker biasa (bukan Vercel):

- Set `BASE_URL` di `.env` sesuai domain publik server.
- Puppeteer butuh beberapa system dependency Chromium di OS-nya. Kalau
  muncul error terkait `libnss3`, dll, install dependency headless Chrome
  sesuai OS (lihat dokumentasi resmi Puppeteer: Troubleshooting -> Running
  Puppeteer on \<OS\>).
- Di lingkungan non-serverless seperti ini, kode akan otomatis pakai
  `puppeteer` biasa (bukan versi `@sparticuz/chromium`) karena env var
  `VERCEL`/`AWS_LAMBDA_FUNCTION_NAME` tidak ada.
