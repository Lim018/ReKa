# Design Generator

Generator desain UI yang dijalankan lewat Claude Code (memakai langganan, tanpa API key).
Claude Code berperan sebagai desainer. Project ini menyediakan alur kerja (skill) dan alat ukur (script).

## Setup
```
npm install
npx playwright install chromium
```

## Pemakaian lewat UI
```
npm start
```
Buka http://localhost:4000. Pilih mode dan output, isi brief atau sumber (URL, path lokal, upload), lalu
klik Generate. Progres tampil live. Hasil bisa dilihat (desktop, mobile, HTML, design.md, sebelum/sesudah),
diunduh, dan direvisi dari halaman yang sama.

Di belakang layar server menjalankan `claude -p` (Claude Code headless) dengan login langganan Anda.
Karena itu:
- **Hanya untuk pemakaian pribadi.** Server hanya menerima koneksi dari komputer ini (`127.0.0.1`).
  Jangan di-hosting atau dibagikan ke orang lain; untuk itu gunakan Claude API dengan API key.
- Izin Claude dibatasi: hanya menjalankan `node scripts/*.mjs`, menulis di `output/`, dan membaca file.
  Tidak ada Bash bebas maupun MCP server, supaya instruksi tersembunyi di halaman yang di-redesign tidak
  bisa menyuruh Claude melakukan hal lain.
- **Satu proyek = satu session Claude Code.** Generate awal membuat session dengan ID tetap
  (bernama `ReKa: <judul>`), dan setiap pesan lanjutan dari UI melanjutkan session tersebut
  (`--resume`), sehingga Claude ingat seluruh percakapan proyek itu. Session yang sama bisa dibuka di
  terminal dengan perintah yang tampil di halaman proyek (`claude --resume <id>`). Session ini juga
  muncul di daftar `/resume` Claude Code untuk folder ini.
- Riwayat setiap run tersimpan di `output/<proyek>/log.jsonl`.
- Model (Opus/Sonnet/Haiku) dan effort (low–max) bisa dipilih per generate dan per pesan lanjutan.
  "Default" memakai setelan Claude Code Anda. Mengganti model di tengah session tetap mempertahankan konteks.
- Toggle **Caveman** (jika caveman terpasang di Claude Code Anda). On: hook caveman aktif dan MCP caveman dimuat
  (MCP lain tetap diblokir). Off: semua hook dimatikan untuk run itu, termasuk hook user lain, karena hook caveman
  tidak bisa dimatikan satu per satu. Halaman proyek menampilkan receipt caveman untuk session tersebut
  (jumlah event dan kompresi).
- Satu proses berjalan pada satu waktu, dengan batas 20 menit per proses.
- Port bisa diganti: `PORT=5000 npm start`.

## Pemakaian lewat terminal
Jalankan `claude` di folder ini, lalu:
```
/design-generator landing page klinik gigi premium, output png dan html
/design-generator redesign https://contoh.com, gaya lebih modern
/design-generator redesign ./screenshot-lama.png, output design.md saja
```
Hasil disimpan di `output/<slug>/`: `tokens.json`, `design.md`, `index.html`, `preview-desktop.png`, `preview-mobile.png`
(redesign juga menghasilkan `source/original.png` + `source/styles.json`).

## Isi
| File | Fungsi |
|---|---|
| `server.mjs` + `ui/index.html` | UI lokal dan server yang menjalankan Claude Code headless |
| `.claude/skills/design-generator/SKILL.md` | Alur kerja dan aturan output (ubah file ini untuk mengatur perilaku generator) |
| `scripts/extract.mjs <url\|file> <dir>` | Ambil warna, font, spacing, struktur, dan screenshot dari sistem lama |
| `scripts/validate.mjs <tokens.json>` | Cek token: warna wajib, format hex, kontras WCAG, skala font/spacing |
| `scripts/lint.mjs <html>` | Cek halaman: warna di luar token, gambar/CDN eksternal, versi library, alt/lang, `prefers-reduced-motion`, kata klise |
| `scripts/render.mjs <html> <png> [--width N] [--wait ms]` | Render HTML ke PNG (full page). Men-scroll agar reveal terpicu, menunggu animasi/3D, dan melaporkan error JS |

Untuk dijadikan produk/web app nanti, script ini tetap dipakai, dan Claude Code diganti dengan panggilan Claude API.
