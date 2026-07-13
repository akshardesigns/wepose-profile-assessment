/* Entry point untuk Vercel Serverless Function.
   File dengan nama [...all].js jadi "catch-all" otomatis untuk semua
   path di bawah /api/* (mis. /api/assessments, /api/pdf, dst),
   tanpa perlu konfigurasi rewrite tambahan di vercel.json.
   Express app dari server.js bisa langsung dipakai sebagai handler
   (req, res) karena Express app memang callable seperti itu. */
module.exports = require('../server');
