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

## Cek terdaftar WhatsApp (Tahap 2)

Nomor **Siap** dan **Ragu** dicek ke WhatsApp lewat **perangkat pengecek** (nomor WhatsApp khusus, bukan nomor blast)
yang dipasangkan di menu **Pengecek WA**. Pengecekan berjalan di latar belakang server; halaman boleh ditutup.

- Nomor yang tidak terdaftar pindah ke **Buang** (alasan *Tidak terdaftar WhatsApp*).
- Hanya jawaban pasti dari WhatsApp yang dipakai. Nomor yang tiga kali tidak dijawab pasti ditandai *WhatsApp tidak pasti*
  (tetap Ragu, tidak dibuang).
- Gateway menyertakan nomor perangkat itu sendiri sebagai **kontrol** di setiap kueri. Bila tidak terbaca (tanda dibatasi
  WhatsApp), perangkat **ditahan otomatis** (bawaan 30 menit, menggandakan), nomor yang sedang dicek kembali ke antrean,
  perangkat lain tetap bekerja.
- Laju bisa diatur (bawaan hati-hati: 20 nomor per 8-15 detik, 15.000/hari per perangkat). Lebih banyak perangkat =
  lebih cepat; perkiraan waktu tampil di kartu cek.
- Hasil disimpan (cache) dan dipakai ulang untuk daftar lain selama 30 hari (bisa diatur): nomor yang sama tidak dicek dua kali.
- Butuh gateway **AABaileys** dengan endpoint `POST /api/contacts/check-exists-batch` dan `profile-batch` (cabang `claude/inspiring-pascal-u9tnq7`
  di repo AABaileys). Pakai **instance gateway terpisah** dari WSPRO.

## Skor aktif (Tahap 2b)

Setelah cek terdaftar selesai, nomor yang **terdaftar** diberi **skor aktif 0-100**: rata-rata berbobot dari sinyal profil
yang dibaca gateway lewat Baileys (`POST /api/contacts/profile-batch`). Sinyal yang tidak terbaca (disembunyikan privasi)
**tidak dihitung**, jadi tidak menurunkan skor; rata-rata hanya dari sinyal yang ada.

| Sinyal | Bobot | Poin |
| --- | --- | --- |
| Perangkat terakhir berubah (kunci perangkat) | 3 | ≤30 hari 100, ≤90 90, ≤180 80, ≤1 th 65, ≤2 th 50, ≤3 th 40, lebih lama 30 |
| About (umur tulisan) | 2 | ≤90 hari 100, ≤1 th 80, ≤3 th 60, lebih lama 40; teks bawaan WhatsApp -30; disembunyikan = tidak dihitung |
| Foto profil | 2 | ada 85, tidak ada 30, disembunyikan = tidak dihitung |
| Perangkat tertaut (WA Web/desktop) | 1 | ada 100, tidak ada = tidak dihitung |
| Pesan sementara diatur | 1 | ≤1 th 100, lebih lama 75 |

- Skor di bawah **ambang Ragu** (bawaan 50) → Ragu (*Aktivitas rendah*); di bawah **ambang Buang** (bawaan 25) → Buang
  (*Kemungkinan tidak aktif*).
- **Akun bisnis** (WhatsApp Business / API) → Ragu (*Akun bisnis*) atau dibiarkan, sesuai pengaturan.
- Semua bisa diatur di **Pengecek WA > Aturan**: aktif/nonaktif, cek foto (lebih lambat: maks 20 nomor per kueri),
  cek bisnis, kedua ambang. Hasil juga disimpan (cache) untuk daftar lain.
- Skor dan sinyal tampil di kolom **Aktif** tabel nomor (arahkan kursor untuk rinciannya) dan di unduhan CSV lengkap
  (`whatsapp`, `skor_aktif`).
- Bobot dan ambang adalah titik awal: perlu dikalibrasi dengan hasil kirim nyata dari WSPRO.

## Laporan Bio

Menu **Laporan Bio** merangkum satu daftar dari hasil cek WhatsApp yang sudah tersimpan (tanpa kueri tambahan):
terdaftar / tidak terdaftar, bio (ditulis sendiri, teks bawaan, kosong, disembunyikan), akun pribadi vs **Business Meta per
level**, dan **tahun sertifikat bisnis diterbitkan**, lengkap dengan daftar nomor bisnis per level. Unduhan **.txt** berisi
seluruh nomor bisnis tanpa batas.

- Level = `verified_level` sertifikat nama bisnis dari WhatsApp (mis. `low`, `high`); tahun = waktu terbit sertifikat itu
  (perkiraan umur akun bisnis, bukan umur nomor). Butuh gateway AABaileys versi yang mengirim `bisnisVn`.
- Bio dan bisnis terbaca pada fase **skor aktif**: nyalakan *Nilai aktivitas akun* di Pengecek WA.

## Rencana berikutnya

- **Tahap 3: kirim ke WSPRO**: tombol buat kampanye (draft) berisi nomor Siap kirim lewat endpoint ber-kunci API di WSPRO;
  opsional, riwayat nomor dari WSPRO (pernah invalid, tanpa tanda terima, Black List) ikut menentukan skor.

## Teknologi

TanStack Start + React + Tailwind (sama dengan WSPRO, tanpa Lovable), Supabase self-hosted terpisah dari WSPRO.

- `src/lib/kualitas.ts`: mesin kualitas (murni, dites).
- `src/lib/daftar.functions.ts`: fungsi server (buat daftar, unggah per 10.000 nomor, analisis, ringkasan, unduhan).
- `src/routes/api/ekspor.$tiket.ts`: unduhan CSV yang dialirkan dari database.
- `db/migrations/`: skema database (dijalankan manual oleh pemilik).

## Pemasangan

1. **Supabase baru** (self-hosted, terpisah dari WSPRO). Jalankan `db/migrations/001_awal.sql` lalu
   `002_cek_whatsapp.sql`, `003_skor_aktif.sql`, `004_batas_waktu.sql`, `005_laporan_bio.sql` di SQL editor.
   Migrasi bersifat aditif dan aman dijalankan ulang; migrasi berikutnya selalu berkas baru.
2. **Pengguna**: buat akun di Supabase > Authentication > Users (email + sandi). Matikan pendaftaran publik
   (Authentication > Providers > Email > *Allow new users to sign up*), karena aplikasi ini hanya untuk pemilik.
3. **Coolify**: New Resource > repo ini > Build Pack **Dockerfile**, port **3000**.
   - Build Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
   - Environment Variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (rahasia), `WA_GATEWAY_URL` dan
     `WA_GATEWAY_API_KEY` (gateway AABaileys khusus pengecek).
   - Jalankan **satu** instance saja: pekerja cek WhatsApp berjalan di dalam proses server.
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
