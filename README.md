# AAwQData

Pengecekan **kualitas nomor target** sebelum dikirim lewat WSPRO. Unggah daftar nomor (CSV, Excel, atau tempel teks),
setiap nomor diperiksa dan diberi skor, lalu daftar dipisah menjadi **Siap kirim**, **Ragu**, dan **Buang** lengkap
dengan alasannya. Hasil per kategori bisa diunduh sebagai CSV (semua baris, tanpa batas).

Dirancang untuk **ratusan ribu nomor per daftar**: 300.000 nomor diperiksa dalam sekitar 20 detik (uji lokal).

## Yang diperiksa (Tahap 1)

| Pemeriksaan | Hasil |
| --- | --- |
| Format dan validitas per negara (libphonenumber, sama dengan WSPRO) | tidak valid, bukan nomor, kosong → Buang |
| Negara target kampanye | nomor negara lain → Buang |
| Salah kode negara saat impor (mis. nomor lokal Hong Kong diberi awalan 62) | dikoreksi otomatis → Ragu (bisa dimatikan) |
| Tipe nomor | telepon rumah, bebas pulsa, premium, VoIP, pager → Buang; tipe tidak pasti → Ragu |
| Pola palsu | digit berulang (…000000), digit urut (…1234567) → Ragu |
| Duplikat dalam daftar | kemunculan kedua dst. → Buang |
| Deret berurutan (…001, …002, … ≥ 10 nomor) | ciri daftar hasil generator → Ragu |

Skor 0–100 dihitung dari bobot alasan (`src/lib/kualitas.ts`, sama dengan fungsi `aawq_bobot` di database).
Format nomor hasil: internasional tanpa `+` (mis. `5511973412856`), sama dengan yang dipakai WSPRO.

## Rencana berikutnya

- **Tahap 2: cek terdaftar di WhatsApp** lewat gateway AABaileys (endpoint `GET /api/contacts/check-exists` gaya WAHA),
  memakai perangkat pengecek khusus, laju dibatasi, bergiliran, berhenti otomatis bila perangkat dibatasi WhatsApp, dan
  hasil disimpan agar nomor yang sama tidak dicek ulang.
- **Tahap 3: kirim ke WSPRO**: tombol buat kampanye (draft) berisi nomor Siap kirim lewat endpoint ber-kunci API di WSPRO;
  opsional, riwayat nomor dari WSPRO (pernah invalid, tanpa tanda terima, Black List) ikut menentukan skor.

## Teknologi

TanStack Start + React + Tailwind (sama dengan WSPRO, tanpa Lovable), Supabase self-hosted terpisah dari WSPRO.

- `src/lib/kualitas.ts`: mesin kualitas (murni, dites).
- `src/lib/daftar.functions.ts`: fungsi server (buat daftar, unggah per 10.000 nomor, analisis, ringkasan, unduhan).
- `src/routes/api/ekspor.$tiket.ts`: unduhan CSV yang dialirkan dari database.
- `db/migrations/`: skema database (dijalankan manual oleh pemilik).

## Pemasangan

1. **Supabase baru** (self-hosted, terpisah dari WSPRO). Jalankan `db/migrations/001_awal.sql` di SQL editor.
   Migrasi bersifat aditif dan aman dijalankan ulang; migrasi berikutnya selalu berkas baru.
2. **Pengguna**: buat akun di Supabase > Authentication > Users (email + sandi). Matikan pendaftaran publik
   (Authentication > Providers > Email > *Allow new users to sign up*), karena aplikasi ini hanya untuk pemilik.
3. **Coolify**: New Resource > repo ini > Build Pack **Dockerfile**, port **3000**.
   - Build Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
   - Environment Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (rahasia).
   Lihat `.env.example`.

## Pengembangan

```bash
npm install
npm run dev        # http://localhost:8080 (butuh .env berisi variabel di atas)
npm test           # tes mesin kualitas, pembaca berkas, keselarasan bobot SQL
npm run typecheck
npm run build && npm start
```

## Catatan keamanan

- Browser hanya memegang sesi login; semua data lewat fungsi server yang memeriksa pemilik daftar.
- Tabel memakai RLS (pengguna hanya bisa membaca miliknya); fungsi database hanya untuk service role.
- Tautan unduhan berupa tiket acak sekali pakai yang kedaluwarsa dalam 10 menit.
