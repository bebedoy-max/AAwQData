-- AAwQData 004: batas waktu perintah untuk server aplikasi.
--
-- Supabase membatasi perintah lewat API (PostgREST) sekitar 8 detik. Analisis daftar ratusan ribu nomor
-- (duplikat, deret) dan ringkasannya butuh lebih lama, sehingga gagal dengan
-- "canceling statement due to statement timeout". Semua panggilan database AAwQData dilakukan server aplikasi
-- dengan peran service_role (tidak pernah dari browser), jadi batas waktu peran itu saja yang dilonggarkan;
-- anon dan authenticated tetap dengan batas bawaan.
--
-- Aman dijalankan ulang. Setelah menjalankan berkas ini, bila masih timeout, restart container "Supabase Rest".

alter role service_role set statement_timeout = '15min';

-- Minta PostgREST memuat ulang pengaturan peran.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
