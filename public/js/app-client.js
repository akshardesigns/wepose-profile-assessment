/* ============================================================
   WEPOSE app-client.js — logic khusus index.html:
   - baca form -> state object (format sama persis dgn yg dipakai report.js)
   - render preview pakai WeposeReport (engine yang sama dgn PDF)
   - riwayat (list/load/delete) dari Google Sheets via /api/assessments
   - simpan (create/update)
   - cetak PDF -> server (Puppeteer) -> download file
   ============================================================ */

let photoDataUrl = null;
let currentId = null;      // id record yang sedang diedit (null = record baru)
let isDirty = false;

/* ---------------- ukuran preview (zoom) ---------------- */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.5;
const ZOOM_STEP = 0.1;
const PAGE_WIDTH_MM = 210;
let previewZoom = parseFloat(localStorage.getItem('wepose_preview_zoom')) || 1;

function applyZoom() {
  previewZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, previewZoom));
  const wrap = document.getElementById('pagesZoomWrap');
  if (wrap) wrap.style.setProperty('--preview-zoom', previewZoom);
  const label = document.getElementById('zoomValue');
  if (label) label.textContent = Math.round(previewZoom * 100) + '%';
  localStorage.setItem('wepose_preview_zoom', previewZoom);
}
function zoomIn() { previewZoom += ZOOM_STEP; applyZoom(); }
function zoomOut() { previewZoom -= ZOOM_STEP; applyZoom(); }
function zoomReset() { previewZoom = 1; applyZoom(); }
function zoomFit() {
  const panel = document.querySelector('.preview-panel');
  if (!panel) return;
  const pageWidthPx = (PAGE_WIDTH_MM / 25.4) * 96; // konversi mm -> px pada 96dpi
  const available = panel.clientWidth - 24; // sisakan sedikit ruang di kanan-kiri
  previewZoom = available / pageWidthPx;
  applyZoom();
}
window.addEventListener('resize', () => { /* biarkan user set ulang manual via tombol "Sesuaikan" */ });

const DIM_KEYS = ['temuan', 'kekuatan', 'kelemahan', 'dimata', 'catatan'];

function val(id) { return document.getElementById(id).value; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

/* ---------------- state <-> form ---------------- */
function buildStateFromForm() {
  const dims = [];
  for (let i = 1; i <= 4; i++) {
    const dim = {};
    DIM_KEYS.forEach(k => { dim[k] = val(`d${i}_${k}`); });
    dims.push(dim);
  }
  return {
    cover: {
      nama: val('c_nama'), umur: val('c_umur'), paspor: val('c_paspor'),
      negara: val('c_negara'), visa: val('c_visa'), tujuan: val('c_tujuan'),
      sponsor: val('c_sponsor'), tanggal: val('c_tanggal'), fotoDataUrl: photoDataUrl
    },
    dims,
    kesimpulan: {
      skor: val('k_skor'), risiko: val('k_risiko'),
      ringkasan: val('k_ringkasan'), rekomendasi: val('k_rekomendasi'), catatan: val('k_catatan')
    }
  };
}

function loadStateToForm(state) {
  const c = state.cover || {};
  setVal('c_nama', c.nama); setVal('c_umur', c.umur); setVal('c_paspor', c.paspor);
  setVal('c_negara', c.negara); setVal('c_visa', c.visa); setVal('c_tujuan', c.tujuan);
  setVal('c_sponsor', c.sponsor); setVal('c_tanggal', c.tanggal);
  photoDataUrl = c.fotoDataUrl || null;

  const dims = state.dims || [];
  for (let i = 0; i < 4; i++) {
    const dim = dims[i] || {};
    DIM_KEYS.forEach(k => setVal(`d${i + 1}_${k}`, dim[k]));
  }

  const k = state.kesimpulan || {};
  setVal('k_skor', k.skor);
  document.getElementById('k_risiko').value = k.risiko || 'Sedang';
  setVal('k_ringkasan', k.ringkasan); setVal('k_rekomendasi', k.rekomendasi); setVal('k_catatan', k.catatan);
}

/* ---------------- live preview ---------------- */
function render() {
  const state = buildStateFromForm();
  document.getElementById('pages').innerHTML = WeposeReport.renderAllPagesHTML(state);
  
  // Update photo preview in form panel
  const wrap = document.getElementById('photoPreviewWrap');
  if (wrap) {
    wrap.innerHTML = photoDataUrl
      ? `<img src="${photoDataUrl}">`
      : `<svg class="icon" viewBox="0 0 24 24" style="width:55%;height:55%;color:#fff;stroke-width:2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/></svg>`;
  }

  markDirty();
  const runFit = () => requestAnimationFrame(() => requestAnimationFrame(() => WeposeReport.autofitAll(document)));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(runFit).catch(runFit);
  } else {
    runFit();
  }
}

function handlePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (ev) {
    photoDataUrl = ev.target.result;
    render();
  };
  reader.readAsDataURL(file);
}

/* ---------------- status / toast ---------------- */
function markDirty() {
  isDirty = true;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (!dot || !text) return;
  dot.className = 'status-dot dirty';
  text.textContent = currentId ? 'Ada perubahan belum disimpan' : 'Belum disimpan';
}
function markSaved(id) {
  isDirty = false;
  currentId = id;
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  dot.className = 'status-dot saved';
  text.textContent = 'Tersimpan ke Google Sheets';
}
let toastTimer = null;
function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

/* ---------------- riwayat (Google Sheets) ---------------- */
async function muatRiwayat() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="history-empty"><span class="spinner"></span>&nbsp; Memuat riwayat...</div>';
  try {
    const res = await fetch('/api/assessments');
    if (!res.ok) throw new Error('Gagal memuat riwayat (' + res.status + ')');
    const rows = await res.json();
    if (!rows.length) {
      list.innerHTML = '<div class="history-empty">Belum ada data tersimpan.</div>';
      return;
    }
    list.innerHTML = rows.map(r => {
      const badgeClass = r.risiko === 'Rendah' ? 'hbadge-rendah' : (r.risiko === 'Tinggi' ? 'hbadge-tinggi' : 'hbadge-sedang');
      return `
        <div class="history-item">
          <div class="hname">${escapeHtml(r.nama || '(tanpa nama)')}</div>
          <div class="hmeta">${escapeHtml(r.paspor || '-')} · ${escapeHtml(r.negara || '-')} · ${escapeHtml(r.tanggal || '-')}</div>
          ${r.risiko ? `<span class="hbadge ${badgeClass}">${escapeHtml(r.risiko)}</span>` : ''}
          <div class="hactions">
            <button class="hbtn-load" onclick="muatRecord('${r.id}')">Muat</button>
            <button class="hbtn-del" onclick="hapusRecord('${r.id}')">Hapus</button>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="history-empty">Gagal memuat riwayat: ' + escapeHtml(err.message) + '</div>';
  }
}

async function muatRecord(id) {
  try {
    const res = await fetch('/api/assessments/' + encodeURIComponent(id));
    if (!res.ok) throw new Error('Data tidak ditemukan');
    const state = await res.json();
    loadStateToForm(state);
    currentId = id;
    render();
    markSaved(id);
    showToast('Data dimuat ke form.');
  } catch (err) {
    showToast('Gagal memuat data: ' + err.message, true);
  }
}

async function hapusRecord(id) {
  if (!confirm('Hapus data ini dari Google Sheets? Tindakan ini tidak bisa dibatalkan.')) return;
  try {
    const res = await fetch('/api/assessments/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus (' + res.status + ')');
    showToast('Data dihapus.');
    if (currentId === id) mulaiBaru();
    muatRiwayat();
  } catch (err) {
    showToast('Gagal menghapus: ' + err.message, true);
  }
}

async function simpanRiwayat() {
  const btn = document.getElementById('btnSave');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Menyimpan...';
  try {
    const state = buildStateFromForm();
    const payload = { id: currentId, state };
    const res = await fetch('/api/assessments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Gagal menyimpan (' + res.status + ')');
    const data = await res.json();
    markSaved(data.id);
    showToast('Tersimpan ke Google Sheets.');
    muatRiwayat();
  } catch (err) {
    showToast('Gagal menyimpan: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function mulaiBaru() {
  resetForm();
  currentId = null;
  markDirty();
  document.getElementById('statusText').textContent = 'Belum disimpan';
}

/* ---------------- cetak PDF (server-side, Puppeteer) ---------------- */
async function cetakPDF() {
  const btn = document.getElementById('btnPdf');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = '⏳ Menyiapkan PDF...';
  try {
    const state = buildStateFromForm();
    const pdfRes = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    if (!pdfRes.ok) {
      const errText = await pdfRes.text().catch(() => '');
      throw new Error('Gagal membuat PDF ' + (errText ? '— ' + errText : ''));
    }
    const blob = await pdfRes.blob();
    const url = URL.createObjectURL(blob);
    const namaFile = (val('c_nama') || 'profile-assessment').trim().replace(/\s+/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `WEPOSE_${namaFile}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showToast('PDF siap diunduh.');
  } catch (err) {
    showToast(err.message || 'Gagal membuat PDF', true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/* ---------------- util ---------------- */
function escapeHtml(s) {
  return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------- sample & reset ---------------- */
function fillSample() {
  setVal('c_nama', 'Budi Santoso');
  setVal('c_umur', '38 tahun');
  setVal('c_paspor', 'E7503067');
  setVal('c_negara', 'Prancis');
  setVal('c_visa', 'Schengen C - Wisata');
  setVal('c_tujuan', 'Wisata');
  setVal('c_sponsor', 'Biaya Sendiri');
  setVal('c_tanggal', new Date().toISOString().slice(0, 10));

  setVal('d1_temuan', 'Pemohon bekerja di PT. BPR Bank Wonosobo (BUMD) sebagai Head of Funding, Education and Financial Literacy Division. Perusahaan merupakan perusahaan berskala besar, dan pemohon telah bekerja secara konsisten selama 10 tahun. Hingga saat ini, dokumen pendukung pekerjaan yang akan dilampirkan masih belum disebutkan sehingga perlu dipastikan kelengkapannya sebelum pengajuan visa.');
  setVal('d1_kekuatan', 'Pemohon memiliki masa kerja yang sangat stabil, yaitu selama 10 tahun di perusahaan yang sama. Hal ini menunjukkan loyalitas serta kestabilan karier.\nBekerja di PT. BPR Bank Wonosobo (BUMD) menjadi nilai tambah karena merupakan perusahaan milik pemerintah daerah yang memiliki struktur organisasi dan kredibilitas yang baik.\nJabatan sebagai Head of Funding, Education and Financial Literacy Division menunjukkan bahwa pemohon menduduki posisi manajerial dengan tanggung jawab yang cukup tinggi.');
  setVal('d1_kelemahan', 'Dokumen pendukung pekerjaan belum disebutkan sehingga belum dapat dipastikan apakah bukti yang akan dilampirkan sudah memadai.\nUntuk memperkuat aplikasi visa, disarankan melampirkan:\n1. Surat Keterangan Kerja.\n2. Surat Izin Cuti.\n3. Slip Gaji 3-6 bulan terakhir.\n4. SK Pengangkatan atau bukti jabatan (apabila tersedia).\n5. ID Card karyawan atau dokumen pendukung lainnya.');
  setVal('d1_dimata', 'Kedutaan akan menilai apakah pekerjaan pemohon menunjukkan stabilitas karier, sumber penghasilan yang tetap, serta ikatan yang kuat dengan Indonesia. Masa kerja selama 10 tahun serta jabatan manajerial merupakan nilai yang sangat positif dan menunjukkan kecil kemungkinan pemohon meninggalkan pekerjaannya untuk menetap di wilayah Schengen. Namun demikian, penilaian tersebut harus didukung dengan dokumen pekerjaan yang lengkap dan konsisten, karena petugas visa tidak hanya melihat jabatan atau lama bekerja, tetapi juga memastikan seluruh dokumen dapat membuktikan hubungan kerja yang masih aktif dan adanya kewajiban pemohon untuk kembali bekerja setelah perjalanan selesai.');
  setVal('d1_catatan', 'Dokumen yang lengkap akan mempermudah pihak kedutaan dalam memverifikasi status pekerjaan pemohon.');

  setVal('d2_temuan', 'Pemohon memiliki rekening tabungan aktif dengan riwayat mutasi yang stabil selama 6 bulan terakhir. Saldo mengendap berada pada kisaran yang wajar dibandingkan dengan estimasi biaya perjalanan.');
  setVal('d2_kekuatan', 'Saldo mengendap konsisten tanpa lonjakan dana mendadak yang mencurigakan.\nSumber dana dapat ditelusuri berasal dari gaji bulanan yang rutin masuk.');
  setVal('d2_kelemahan', 'Rekening koran 3 bulan terakhir belum dilampirkan.\nBeberapa dokumen pendukung yang disarankan:\n1. Rekening koran 3-6 bulan terakhir.\n2. Surat referensi bank (apabila tersedia).');
  setVal('d2_dimata', 'Kestabilan finansial pemohon akan dinilai positif selama mutasi rekening dapat menunjukkan sumber dana yang jelas dan konsisten dengan profil pekerjaan.');
  setVal('d2_catatan', 'Kelengkapan dokumen finansial akan memperkuat keyakinan petugas visa atas kemampuan pemohon membiayai perjalanan.');

  setVal('d3_temuan', 'Pemohon belum memiliki riwayat perjalanan internasional sebelumnya. Ini merupakan pengajuan visa Schengen pertama bagi pemohon.');
  setVal('d3_kekuatan', 'Tidak ada catatan negatif atau riwayat penolakan visa sebelumnya.');
  setVal('d3_kelemahan', 'Minimnya riwayat perjalanan internasional dapat menjadi pertimbangan tambahan bagi petugas visa.\nDisarankan melampirkan itinerary perjalanan yang jelas dan terperinci.');
  setVal('d3_dimata', 'Sebagai pemohon first-timer, petugas visa akan memberi perhatian lebih pada konsistensi rencana perjalanan dan ikatan pemohon dengan negara asal.');
  setVal('d3_catatan', 'Itinerary yang rapi dan realistis akan membantu meyakinkan petugas visa atas tujuan perjalanan yang jelas.');

  setVal('d4_temuan', 'Pemohon telah menikah dan memiliki dua orang anak yang masih bersekolah di Indonesia. Pemohon juga merupakan pemilik properti atas nama pribadi di kota domisili.');
  setVal('d4_kekuatan', 'Kepemilikan properti menjadi bukti kuat ikatan ekonomi dengan Indonesia.\nTanggungan keluarga (pasangan dan anak yang bersekolah) memperkuat alasan kepulangan setelah perjalanan selesai.');
  setVal('d4_kelemahan', 'Dokumen kepemilikan properti (sertifikat/PBB) belum dilampirkan.\nDisarankan melampirkan:\n1. Kartu Keluarga.\n2. Sertifikat/bukti kepemilikan aset.');
  setVal('d4_dimata', 'Profil keluarga dan aset yang dimiliki pemohon akan dipandang sebagai indikator kuat rendahnya risiko overstay.');
  setVal('d4_catatan', 'Ikatan keluarga dan aset yang terdokumentasi dengan baik menjadi salah satu faktor penguat utama dalam aplikasi visa ini.');

  setVal('k_skor', '78/100');
  document.getElementById('k_risiko').value = 'Sedang';
  setVal('k_ringkasan', 'Secara keseluruhan, profil pemohon menunjukkan ikatan ekonomi dan personal yang cukup kuat dengan Indonesia, didukung oleh stabilitas pekerjaan dan kepemilikan aset. Kelemahan utama terletak pada kelengkapan dokumen pendukung yang perlu segera dilengkapi sebelum pengajuan.');
  setVal('k_rekomendasi', 'Lengkapi seluruh dokumen pendukung pekerjaan dan finansial sesuai catatan di masing-masing dimensi.\nSusun itinerary perjalanan yang realistis dan terperinci.\nLampirkan bukti kepemilikan aset dan Kartu Keluarga untuk memperkuat ikatan personal.');
  setVal('k_catatan', 'Laporan ini merupakan instrumen penilaian kesiapan profil dan bukan jaminan hasil keputusan visa oleh pihak kedutaan.');

  render();
}

function resetForm() {
  document.querySelectorAll('input[type=text],input[type=date],textarea').forEach(el => el.value = '');
  document.getElementById('k_risiko').value = 'Sedang';
  photoDataUrl = null;
  render();
}

/* ---------------- init ---------------- */
render();
muatRiwayat();
applyZoom();
