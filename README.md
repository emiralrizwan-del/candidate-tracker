# BSM Candidate Search — Live Smartsheet Search Tool

Web app internal untuk mencari kandidat crew secara live dari 6 sheet pipeline
rekrutmen di Smartsheet: Newly Registered → Online Registration → Screening →
Ready to Assess → Assessed → Gap Pool.

## Cara Kerja

- Frontend (`public/index.html`) menampilkan form filter: Posisi, Cruise
  Experience, Cruise Type, Provinsi, C1/D Exp Date, Schengen Exp Date.
- Saat klik "Cari Kandidat", frontend memanggil `api/search.js` (serverless
  function).
- `api/search.js` query ke Smartsheet API secara **live** (bukan cache) ke
  ke-6 sheet, filter hasil di server, lalu gabungkan menjadi satu daftar —
  lengkap dengan info tahap pipeline kandidat saat ini.
- Hasil bisa langsung diklik WhatsApp-nya atau di-export ke CSV.

## Setup & Deploy (Vercel)

1. Push folder ini ke repo GitHub baru (atau upload langsung ke Vercel).
2. Di Vercel dashboard, buat project baru dari repo tersebut.
3. Di **Settings → Environment Variables**, tambahkan:
   - `SMARTSHEET_API_TOKEN` — API token Smartsheet Anda
     (Smartsheet → Account → Apps & Integrations → API Access → Generate new access token)
   - `ACCESS_PASSWORD` — password internal untuk tim (misal: `bsm2026`)
4. Deploy. Vercel otomatis mendeteksi folder `api/` sebagai serverless
   function dan `public/` sebagai static site.
5. Bagikan URL + password ke 9 anggota tim.

## Catatan Keamanan

- Token Smartsheet **tidak pernah** terekspos ke browser — hanya dipakai di
  server (`api/search.js`).
- Password akses (`ACCESS_PASSWORD`) adalah proteksi dasar untuk tim internal,
  bukan sistem login penuh. Cukup untuk kebutuhan saat ini (9 orang, data
  internal), tapi bisa ditingkatkan ke email whitelist BSM jika diperlukan
  nanti.

## Menambah Kriteria Filter Baru

Kolom yang bisa difilter/ditampilkan diatur di `WANTED_COLUMNS` (di
`api/search.js`). Tinggal tambahkan judul kolom persis seperti di Smartsheet,
lalu tambahkan logic filter di fungsi `matchesFilters()`. Tidak perlu
hardcode Column ID — sistem otomatis resolve title → ID per sheet saat
runtime.

## Kenapa Bukan via Claude/LLM?

Pencarian ini query Smartsheet API secara langsung dan deterministik (bukan
lewat AI), supaya hasilnya instan (<1 detik) dan akurat 100% — tidak ada
risiko salah tafsir data oleh model bahasa.
