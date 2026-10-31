-- AAwQData 006: sumber reader (perangkat pengecek) bisa dipilih di menu Pengaturan.
--   'nq'        = gateway pengecek terpisah (WA_GATEWAY_URL), perangkat dipasangkan di menu Pengecek WA (perilaku lama).
--   'aabaileys' = gateway AABaileys milik WSPRO (WSPRO_GATEWAYS): perangkat yang tersambung di WSPRO dipakai sebagai reader.
-- Aditif dan aman dijalankan ulang. Dijalankan manual oleh pemilik setelah 005.

alter table public.aawq_pengaturan add column if not exists sumber_gateway text not null default 'nq';
do $$ begin
  alter table public.aawq_pengaturan add constraint aawq_pengaturan_sumber_cek check (sumber_gateway in ('nq', 'aabaileys'));
exception when duplicate_object then null; end $$;

-- Perangkat dari WSPRO disalin ke aawq_pengecek dengan sumber 'aabaileys' dan alamat gateway-nya.
-- Sesi WSPRO TIDAK PERNAH dibuat/dihapus dari AAwQData; baris ini hanya penanda pemakaian sebagai reader.
alter table public.aawq_pengecek add column if not exists sumber text not null default 'nq';
alter table public.aawq_pengecek add column if not exists gateway text;
do $$ begin
  alter table public.aawq_pengecek add constraint aawq_pengecek_sumber_cek check (sumber in ('nq', 'aabaileys'));
exception when duplicate_object then null; end $$;
create index if not exists aawq_pengecek_sumber_idx on public.aawq_pengecek (user_id, sumber);
