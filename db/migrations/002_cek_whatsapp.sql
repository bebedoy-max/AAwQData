-- AAwQData 002: cek nomor terdaftar di WhatsApp lewat perangkat pengecek (gateway AABaileys).
-- Aditif dan aman dijalankan ulang. Dijalankan manual oleh pemilik setelah 001.

-- Perangkat pengecek: nomor WhatsApp khusus yang dipasangkan di gateway (bukan nomor blast WSPRO).
create table if not exists public.aawq_pengecek (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nama text not null,
  sesi text not null unique,
  nomor text,
  status text not null default 'STOPPED',
  aktif boolean not null default true,
  ditahan_sampai timestamptz,
  alasan_tahan text,
  hari date not null default ((now() at time zone 'Asia/Jakarta')::date),
  cek_hari_ini integer not null default 0,
  total_cek bigint not null default 0,
  terakhir_cek timestamptz,
  dibuat timestamptz not null default now()
);
create index if not exists aawq_pengecek_user_idx on public.aawq_pengecek (user_id);

-- Hasil cek per nomor, dipakai ulang lintas daftar selama umur_cache_hari (nomor tidak dicek dua kali).
create table if not exists public.aawq_cek_wa (
  e164 text primary key,
  terdaftar boolean not null,
  dicek_pada timestamptz not null default now()
);

-- Laju cek per pengguna (bawaan hati-hati; cek massal bisa membuat nomor pengecek dibatasi WhatsApp).
create table if not exists public.aawq_pengaturan (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ukuran_kelompok integer not null default 20 check (ukuran_kelompok between 1 and 50),
  jeda_min_detik integer not null default 8 check (jeda_min_detik >= 3),
  jeda_maks_detik integer not null default 15 check (jeda_maks_detik >= 3),
  batas_harian integer not null default 15000 check (batas_harian >= 0),
  umur_cache_hari integer not null default 30 check (umur_cache_hari between 0 and 365)
);

alter table public.aawq_daftar add column if not exists cek_wa_status text not null default 'belum';
alter table public.aawq_daftar add column if not exists cek_wa_mulai timestamptz;
alter table public.aawq_daftar add column if not exists cek_wa_selesai_pada timestamptz;
do $$ begin
  alter table public.aawq_daftar add constraint aawq_daftar_cek_wa_status_cek check (cek_wa_status in ('belum', 'berjalan', 'jeda', 'selesai'));
exception when duplicate_object then null; end $$;

-- wa: true terdaftar, false tidak terdaftar, null belum/tidak pasti. wa_coba: jumlah jawaban tidak pasti.
-- wa_klaim: sedang dicek oleh satu perangkat (kedaluwarsa 5 menit bila perangkat/servernya mati di tengah jalan).
alter table public.aawq_nomor add column if not exists wa boolean;
alter table public.aawq_nomor add column if not exists wa_coba smallint not null default 0;
alter table public.aawq_nomor add column if not exists wa_klaim timestamptz;
create index if not exists aawq_nomor_antre_wa_idx on public.aawq_nomor (daftar_id, id)
  where wa is null and e164 is not null and kategori <> 'buang';
create index if not exists aawq_nomor_e164_idx on public.aawq_nomor (e164) where e164 is not null;

alter table public.aawq_pengecek enable row level security;
alter table public.aawq_cek_wa enable row level security;
alter table public.aawq_pengaturan enable row level security;
drop policy if exists aawq_pengecek_baca_sendiri on public.aawq_pengecek;
create policy aawq_pengecek_baca_sendiri on public.aawq_pengecek for select to authenticated using (user_id = auth.uid());
drop policy if exists aawq_pengaturan_baca_sendiri on public.aawq_pengaturan;
create policy aawq_pengaturan_baca_sendiri on public.aawq_pengaturan for select to authenticated using (user_id = auth.uid());

-- Bobot dan kategori (definisi lengkap terbaru; sama dengan ALASAN di src/lib/kualitas.ts, dijaga tes).
create or replace function public.aawq_bobot(p_alasan text) returns integer
language sql immutable parallel safe as $$
  select case p_alasan
    when 'kosong' then 100 when 'bukan_nomor' then 100 when 'tidak_valid' then 100 when 'negara_lain' then 80
    when 'kode_negara_dikoreksi' then 25 when 'telepon_rumah' then 70 when 'nomor_khusus' then 80
    when 'tipe_tidak_dikenal' then 20 when 'pola_berulang' then 40 when 'pola_urut' then 40
    when 'duplikat' then 100 when 'deret_berurutan' then 30
    when 'tidak_terdaftar_wa' then 100 when 'wa_tidak_pasti' then 10 else 0 end
$$;

create or replace function public.aawq_kategori(p_alasan text[]) returns text
language sql immutable parallel safe as $$
  select case
    when p_alasan && array['kosong', 'bukan_nomor', 'tidak_valid', 'negara_lain', 'telepon_rumah', 'nomor_khusus', 'duplikat', 'tidak_terdaftar_wa'] then 'buang'
    when cardinality(p_alasan) > 0 then 'ragu'
    else 'siap' end
$$;

-- Hitung ulang ringkasan satu daftar.
create or replace function public.aawq_hitung_ulang(p_daftar uuid)
returns void language sql security definer set search_path = public as $$
  update aawq_daftar d set jumlah_total = s.total, jumlah_siap = s.siap, jumlah_ragu = s.ragu, jumlah_buang = s.buang
  from (
    select count(*) total, count(*) filter (where kategori = 'siap') siap,
           count(*) filter (where kategori = 'ragu') ragu, count(*) filter (where kategori = 'buang') buang
      from aawq_nomor where daftar_id = p_daftar
  ) s where d.id = p_daftar
$$;

-- Terapkan hasil cek yang masih segar dari cache ke nomor daftar ini (sebelum mulai cek, agar tidak dicek ulang).
create or replace function public.aawq_terapkan_cache_wa(p_daftar uuid, p_umur_hari integer)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update aawq_nomor m set
    wa = c.terdaftar,
    alasan = case when c.terdaftar then m.alasan else array_append(array_remove(m.alasan, 'tidak_terdaftar_wa'), 'tidak_terdaftar_wa') end,
    wa_klaim = null
  from aawq_cek_wa c
  where m.daftar_id = p_daftar and m.wa is null and m.e164 = c.e164
    and c.dicek_pada > now() - make_interval(days => p_umur_hari);
  get diagnostics n = row_count;
  update aawq_nomor set skor = aawq_skor(alasan), kategori = aawq_kategori(alasan)
   where daftar_id = p_daftar and (skor <> aawq_skor(alasan) or kategori <> aawq_kategori(alasan));
  perform aawq_hitung_ulang(p_daftar);
  return n;
end
$$;

-- Ambil (klaim) sampai p_n nomor yang perlu dicek dari daftar ini. skip locked: beberapa perangkat tidak
-- pernah mendapat nomor yang sama. Hanya nomor yang belum dibuang, belum dicek, dan belum 3x tidak pasti.
create or replace function public.aawq_klaim_wa(p_daftar uuid, p_n integer)
returns setof text language sql security definer set search_path = public as $$
  with calon as (
    select id from aawq_nomor
     where daftar_id = p_daftar and wa is null and e164 is not null and kategori <> 'buang' and wa_coba < 3
       and (wa_klaim is null or wa_klaim < now() - interval '5 minutes')
     order by id
     limit greatest(p_n, 0)
     for update skip locked
  )
  update aawq_nomor m set wa_klaim = now() from calon where m.id = calon.id returning m.e164
$$;

-- Lepas klaim tanpa hasil (gateway menolak/dibatasi): nomor kembali ke antrean.
create or replace function public.aawq_lepas_klaim_wa(p_daftar uuid, p_e164 text[])
returns void language sql security definer set search_path = public as $$
  update aawq_nomor set wa_klaim = null where daftar_id = p_daftar and e164 = any(p_e164) and wa is null
$$;

-- Simpan hasil cek: [{e164, terdaftar: true|false|null}]. Hasil pasti masuk cache dan diterapkan ke SEMUA daftar
-- yang memuat nomor itu (belum dicek). Tidak pasti: dicoba lagi nanti, setelah 3 kali ditandai "wa_tidak_pasti".
create or replace function public.aawq_simpan_cek_wa(p_daftar uuid, p_hasil jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d uuid;
begin
  create temporary table if not exists _hasil (e164 text primary key, terdaftar boolean) on commit drop;
  truncate _hasil;
  insert into _hasil select distinct on (x.e164) x.e164, x.terdaftar from jsonb_to_recordset(p_hasil) as x(e164 text, terdaftar boolean) where x.e164 is not null;

  insert into aawq_cek_wa (e164, terdaftar, dicek_pada)
  select e164, terdaftar, now() from _hasil where terdaftar is not null
  on conflict (e164) do update set terdaftar = excluded.terdaftar, dicek_pada = excluded.dicek_pada;

  -- Daftar lain yang memuat nomor yang sama ikut diperbarui; dicatat untuk hitung ulang ringkasannya.
  create temporary table if not exists _daftar (id uuid primary key) on commit drop;
  truncate _daftar;
  insert into _daftar values (p_daftar);
  with ubah as (
    update aawq_nomor m set
      wa = h.terdaftar,
      alasan = case when h.terdaftar then m.alasan else array_append(array_remove(m.alasan, 'tidak_terdaftar_wa'), 'tidak_terdaftar_wa') end,
      wa_klaim = null
    from _hasil h
    where h.terdaftar is not null and m.e164 = h.e164 and m.wa is null
    returning m.daftar_id
  )
  insert into _daftar select distinct daftar_id from ubah on conflict do nothing;

  update aawq_nomor m set
    wa_coba = m.wa_coba + 1,
    wa_klaim = null,
    alasan = case when m.wa_coba + 1 >= 3 then array_append(array_remove(m.alasan, 'wa_tidak_pasti'), 'wa_tidak_pasti') else m.alasan end
  from _hasil h
  where h.terdaftar is null and m.daftar_id = p_daftar and m.e164 = h.e164 and m.wa is null;

  for d in select id from _daftar loop
    update aawq_nomor set skor = aawq_skor(alasan), kategori = aawq_kategori(alasan)
     where daftar_id = d and e164 in (select e164 from _hasil) and (skor <> aawq_skor(alasan) or kategori <> aawq_kategori(alasan));
    perform aawq_hitung_ulang(d);
  end loop;
end
$$;

-- Kemajuan cek WhatsApp satu daftar.
create or replace function public.aawq_progres_wa(p_daftar uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sisa', count(*) filter (where wa is null and e164 is not null and kategori <> 'buang' and wa_coba < 3),
    'terdaftar', count(*) filter (where wa is true),
    'tidak_terdaftar', count(*) filter (where wa is false),
    'tidak_pasti', count(*) filter (where wa is null and wa_coba >= 3)
  ) from aawq_nomor where daftar_id = p_daftar
$$;

revoke all on function public.aawq_hitung_ulang(uuid) from public, anon, authenticated;
revoke all on function public.aawq_terapkan_cache_wa(uuid, integer) from public, anon, authenticated;
revoke all on function public.aawq_klaim_wa(uuid, integer) from public, anon, authenticated;
revoke all on function public.aawq_lepas_klaim_wa(uuid, text[]) from public, anon, authenticated;
revoke all on function public.aawq_simpan_cek_wa(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.aawq_progres_wa(uuid) from public, anon, authenticated;
grant execute on function public.aawq_hitung_ulang(uuid), public.aawq_terapkan_cache_wa(uuid, integer), public.aawq_klaim_wa(uuid, integer),
  public.aawq_lepas_klaim_wa(uuid, text[]), public.aawq_simpan_cek_wa(uuid, jsonb), public.aawq_progres_wa(uuid) to service_role;
grant all on public.aawq_pengecek, public.aawq_cek_wa, public.aawq_pengaturan to service_role;
grant select on public.aawq_pengecek, public.aawq_pengaturan to authenticated;
