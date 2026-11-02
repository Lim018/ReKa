---
name: design-generator
description: Buat desain UI dari awal atau redesign sistem yang sudah ada (URL, file HTML, screenshot, atau folder kode). Output pilihan - design.md (aturan desain), index.html (standalone), preview PNG. Gunakan saat user meminta design, redesign, mockup, atau design system untuk sebuah halaman/aplikasi.
---

# Design Generator

Kamu adalah desainernya. Script di `scripts/` adalah alat ukur yang pasti: ekstraksi, validasi, render.
Jangan menebak hasil yang bisa diukur script, jalankan scriptnya.

Semua perintah dijalankan dari root project persis dalam bentuk `node scripts/<nama>.mjs ...`:
tanpa `cd`, tanpa `&&`, tanpa pipe. Saat dijalankan dari UI (`server.mjs`), hanya bentuk ini yang
diizinkan. Jika `node_modules/` belum ada, minta user menjalankan
`npm install && npx playwright install chromium`.

Jika prompt sudah menentukan folder output, mode, atau daftar output, ikuti persis dan jangan bertanya.
Ambil asumsi yang masuk akal dan catat di `design.md`.

## 1. Tentukan input

| Mode | Dikenali dari | Yang dibutuhkan |
|---|---|---|
| **design** | Deskripsi/brief tanpa sistem lama | Tujuan halaman, audiens, gaya/mood, jenis halaman |
| **redesign** | URL, path file `.html`, gambar screenshot, atau folder kode | Sumber + arah perubahan (jika tidak disebut: modernisasi, perbaiki hierarki, keterbacaan, aksesibilitas) |

**Output** yang diminta user: `design.md`, `html`, `png` (default: ketiganya). `tokens.json` dan
`design.md` selalu dibuat karena keduanya sumber kebenaran. Jika user meminta PNG, `index.html` juga
dibuat, karena PNG dirender dari HTML.

Tanyakan hanya bila brief benar-benar tidak bisa ditafsirkan. Selain itu ambil asumsi yang masuk akal
dan tulis asumsinya di bagian "Asumsi" pada `design.md`.

Folder output: `output/<slug>/` (slug pendek dari nama proyek, huruf kecil, tanda hubung).

## 2. Analisis (khusus redesign)

- **URL atau file HTML**: `node scripts/extract.mjs <url|file> output/<slug>/source`.
  Lalu baca `source/styles.json` dan **lihat** `source/original.png` dengan Read.
- **Screenshot**: lihat gambarnya langsung, tidak perlu extract.
- **Folder kode**: baca file style (CSS/Tailwind config/theme) dan komponen utama. Jika project bisa
  dijalankan atau ada file HTML hasil build, extract juga.

Catat temuan untuk `design.md`: warna, font, dan spacing yang benar-benar dipakai; inkonsistensi
(misalnya 9 ukuran font berbeda); masalah kontras; hierarki yang lemah; elemen yang wajib dipertahankan
(logo, warna brand, konten, alur navigasi). **Pertahankan konten dan identitas brand** kecuali user
meminta perubahan.

## 3. Design tokens: `output/<slug>/tokens.json`

```json
{
  "name": "Nama Proyek",
  "colors": {
    "background": "#ffffff", "surface": "#f6f7f9", "text": "#14161a", "textMuted": "#5b6270",
    "primary": "#1f5eff", "onPrimary": "#ffffff", "border": "#e2e5ea"
  },
  "contrastPairs": [["accent", "surface", 3]],
  "typography": {
    "fontFamily": { "heading": "\"Inter\", system-ui, sans-serif", "body": "\"Inter\", system-ui, sans-serif" },
    "scale": { "xs": 12, "sm": 14, "base": 16, "lg": 18, "xl": 24, "2xl": 32, "3xl": 48 },
    "lineHeight": { "tight": 1.2, "normal": 1.6 }
  },
  "spacing": [4, 8, 12, 16, 24, 32, 48, 64, 96],
  "radius": { "sm": 6, "md": 10, "lg": 16, "full": 9999 },
  "shadow": { "sm": "0 1px 2px rgba(0,0,0,.06)", "md": "0 8px 24px rgba(0,0,0,.08)" }
}
```

Tujuh warna di atas wajib ada. Warna tambahan (accent, success, danger, dll) boleh ditambahkan, dan
pasangan kontrasnya didaftarkan di `contrastPairs` sebagai `[fg, bg, minRatio]`.

Lalu jalankan `node scripts/validate.mjs output/<slug>/tokens.json`. **Perbaiki token sampai lolos**
sebelum lanjut. Jangan menurunkan batas kontras supaya lolos.

## 4. `design.md`: aturan desain

Wajib berisi bagian berikut, dengan nilai yang sama persis dengan `tokens.json`:

1. **Ringkasan**: tujuan, audiens, kepribadian visual (3–5 kata sifat), mode (design/redesign).
2. **Asumsi**: hal yang tidak disebut user lalu diputuskan sendiri.
3. **Temuan sistem lama** *(redesign saja)*: masalah utama dan apa yang dipertahankan.
4. **Warna**: tabel token, hex, peran, dan rasio kontras dari output validate. Sertakan *do/don't*.
5. **Tipografi**: font, skala (token → px → penggunaan), line-height, aturan weight.
6. **Spacing & layout**: skala spacing, grid/max-width, breakpoint.
7. **Radius, border, shadow**: nilai dan kapan dipakai.
8. **Komponen**: button (primary/secondary/ghost + state hover/focus/disabled), input, card,
   navigasi, dan komponen khusus halaman ini. Untuk tiap komponen tulis token yang dipakai.
9. **Aksesibilitas**: kontras, focus ring, ukuran target sentuh minimal 44px, semantik HTML.
10. **Perubahan dari versi lama** *(redesign saja)*: tabel sebelum → sesudah → alasan.

Tulis dalam bahasa yang dipakai user.

## 5. `index.html`: standalone

- Satu file. CSS ada di `<style>`. Tanpa framework, tanpa build step. JavaScript hanya bila interaksinya
  memang bagian dari desain.
- Semua token menjadi CSS custom properties di `:root` (`--color-primary`, `--space-4`, `--text-xl`, ...)
  dan **hanya** variabel tersebut yang dipakai di stylesheet. Tidak boleh ada hex atau px liar di luar
  `:root`, kecuali nilai 0, 1px untuk border, dan breakpoint.
- Font: Google Fonts melalui `<link>` diperbolehkan, dengan fallback sistem yang tertulis di token.
- Gambar: SVG inline atau blok warna/gradien. Jangan memakai URL gambar eksternal yang bisa mati.
- Konten realistis sesuai brief (bukan lorem ipsum). Untuk redesign, gunakan konten asli.
- HTML semantik (`header`, `nav`, `main`, `section`, `footer`), `lang` terisi, `:focus-visible` terlihat.
  Responsif dari 360px sampai 1440px.

## 6. PNG

```
node scripts/render.mjs output/<slug>/index.html output/<slug>/preview-desktop.png --width 1440
node scripts/render.mjs output/<slug>/index.html output/<slug>/preview-mobile.png --width 390
```

**Lihat kedua PNG** dengan Read. Jika ada yang rusak (overflow, teks bertabrakan, section kosong,
kontras buruk, font gagal dimuat), perbaiki HTML lalu render ulang. Untuk redesign, bandingkan dengan
`source/original.png`.

## 7. Laporan ke user

Singkat: path file output, 3–5 keputusan desain utama, asumsi yang diambil, dan cara meminta
penyesuaian (misalnya "ganti primary jadi hijau", "font lebih formal"). Saat user meminta penyesuaian,
ubah `tokens.json` → validate → `design.md` → `index.html` → render ulang, supaya semua output tetap
sinkron.
