-- AAwQData 007: Grade A/B/C nomor terdaftar menurut AKTIVITAS TERAKHIR yang terbaca dari WhatsApp.
-- Aktivitas terakhir = tanggal paling baru dari sinyal: perangkat terakhir berubah (kunciTs), About diubah (about.ts),
-- pesan sementara diatur (hilangTs). WhatsApp tidak memberi tanda "dipakai hari ini"; grade A = perubahan yang baru saja
-- terjadi, jadi paling pasti nomor itu dipegang dan dipakai pemiliknya.
--   A: aktivitas terakhir <= grade_a_hari (bawaan 3)    B: <= grade_b_hari (bawaan 30)    C: dinilai, lebih lama / tanpa tanggal
-- Aditif dan aman dijalankan ulang. Dijalankan manual oleh pemilik setelah 006.

alter table public.aawq_nomor add column if not exists aktif_terakhir timestamptz;
alter table public.aawq_pengaturan add column if not exists grade_a_hari integer not null default 3;
alter table public.aawq_pengaturan add column if not exists grade_b_hari integer not null default 30;

create or replace function public.aawq_ts_aman(t text)
returns timestamptz language plpgsql immutable as $$
begin
  return nullif(t, '')::timestamptz;
exception when others then
  return null;
end $$;

create or replace function public.aawq_sinyal_terakhir(s jsonb)
returns timestamptz language sql immutable as $$
  select greatest(
    public.aawq_ts_aman(s ->> 'kunciTs'),
    public.aawq_ts_aman(s -> 'about' ->> 'ts'),
    public.aawq_ts_aman(s ->> 'hilangTs')
  )
$$;

create or replace function public.aawq_nomor_aktif_terakhir()
returns trigger language plpgsql as $$
begin
  new.aktif_terakhir := case when new.aktif_sinyal is null then null else public.aawq_sinyal_terakhir(new.aktif_sinyal) end;
  return new;
end $$;

drop trigger if exists aawq_nomor_aktif_terakhir on public.aawq_nomor;
create trigger aawq_nomor_aktif_terakhir
  before insert or update of aktif_sinyal on public.aawq_nomor
  for each row execute function public.aawq_nomor_aktif_terakhir();

-- Isi untuk nomor yang sudah dinilai sebelumnya.
update public.aawq_nomor
   set aktif_terakhir = public.aawq_sinyal_terakhir(aktif_sinyal)
 where aktif_sinyal is not null and aktif_terakhir is null;

create index if not exists aawq_nomor_grade_idx on public.aawq_nomor (daftar_id, aktif_terakhir) where aktif_dinilai and aktif_skor is not null;

-- Jumlah per grade satu daftar (dihitung relatif terhadap waktu sekarang).
create or replace function public.aawq_grade_wa(p_daftar uuid, p_a_hari integer, p_b_hari integer)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'a', count(*) filter (where aktif_terakhir >= now() - make_interval(days => p_a_hari)),
    'b', count(*) filter (where aktif_terakhir < now() - make_interval(days => p_a_hari) and aktif_terakhir >= now() - make_interval(days => p_b_hari)),
    'c', count(*) filter (where aktif_terakhir is null or aktif_terakhir < now() - make_interval(days => p_b_hari))
  )
  from aawq_nomor
  where daftar_id = p_daftar and aktif_dinilai and aktif_skor is not null
$$;

revoke all on function public.aawq_grade_wa(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.aawq_grade_wa(uuid, integer, integer) to service_role;

notify pgrst, 'reload schema';
