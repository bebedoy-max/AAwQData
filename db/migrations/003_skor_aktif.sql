-- AAwQData 003: skor aktif akun WhatsApp dari sinyal gateway (perangkat, About, foto, akun bisnis, dll).
-- Aditif dan aman dijalankan ulang. Dijalankan manual oleh pemilik setelah 002.
-- Skor dihitung di aplikasi (src/lib/aktivitas.ts) agar bobot/ambang mudah disetel; database menyimpan sinyal mentah,
-- skor, dan alasan, serta mengatur antrean.

alter table public.aawq_nomor add column if not exists aktif_skor smallint;
alter table public.aawq_nomor add column if not exists aktif_dinilai boolean not null default false;
alter table public.aawq_nomor add column if not exists aktif_coba smallint not null default 0;
alter table public.aawq_nomor add column if not exists aktif_klaim timestamptz;
alter table public.aawq_nomor add column if not exists aktif_sinyal jsonb;
create index if not exists aawq_nomor_antre_aktif_idx on public.aawq_nomor (daftar_id, id)
  where wa is true and not aktif_dinilai and kategori <> 'buang';

-- Sinyal mentah per nomor (dipakai ulang lintas daftar selama umur_cache_hari; skor dihitung ulang sesuai ambang daftar).
create table if not exists public.aawq_aktif_wa (
  e164 text primary key,
  sinyal jsonb not null,
  dicek_pada timestamptz not null default now()
);
alter table public.aawq_aktif_wa enable row level security;

alter table public.aawq_pengaturan add column if not exists cek_aktivitas boolean not null default true;
alter table public.aawq_pengaturan add column if not exists cek_foto boolean not null default true;
alter table public.aawq_pengaturan add column if not exists cek_bisnis boolean not null default true;
alter table public.aawq_pengaturan add column if not exists ambang_ragu integer not null default 50;
alter table public.aawq_pengaturan add column if not exists ambang_buang integer not null default 25;
alter table public.aawq_pengaturan add column if not exists bisnis text not null default 'ragu';
do $$ begin
  alter table public.aawq_pengaturan add constraint aawq_pengaturan_bisnis_cek check (bisnis in ('ragu', 'biarkan'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.aawq_pengaturan add constraint aawq_pengaturan_ambang_cek check (ambang_buang between 0 and 100 and ambang_ragu between 0 and 100 and ambang_buang <= ambang_ragu);
exception when duplicate_object then null; end $$;

-- Bobot dan kategori (definisi lengkap terbaru; sama dengan ALASAN di src/lib/kualitas.ts, dijaga tes).
create or replace function public.aawq_bobot(p_alasan text) returns integer
language sql immutable parallel safe as $$
  select case p_alasan
    when 'kosong' then 100 when 'bukan_nomor' then 100 when 'tidak_valid' then 100 when 'negara_lain' then 80
    when 'kode_negara_dikoreksi' then 25 when 'telepon_rumah' then 70 when 'nomor_khusus' then 80
    when 'tipe_tidak_dikenal' then 20 when 'pola_berulang' then 40 when 'pola_urut' then 40
    when 'duplikat' then 100 when 'deret_berurutan' then 30
    when 'tidak_terdaftar_wa' then 100 when 'wa_tidak_pasti' then 10
    when 'aktivitas_rendah' then 20 when 'kemungkinan_tidak_aktif' then 100 when 'akun_bisnis' then 30 else 0 end
$$;

create or replace function public.aawq_kategori(p_alasan text[]) returns text
language sql immutable parallel safe as $$
  select case
    when p_alasan && array['kosong', 'bukan_nomor', 'tidak_valid', 'negara_lain', 'telepon_rumah', 'nomor_khusus', 'duplikat', 'tidak_terdaftar_wa', 'kemungkinan_tidak_aktif'] then 'buang'
    when cardinality(p_alasan) > 0 then 'ragu'
    else 'siap' end
$$;

-- Nomor terdaftar yang belum dinilai dan sinyalnya masih segar di cache (dinilai aplikasi tanpa kueri ke WhatsApp).
create or replace function public.aawq_aktif_dari_cache(p_daftar uuid, p_umur_hari integer, p_n integer)
returns table (e164 text, sinyal jsonb) language sql stable security definer set search_path = public as $$
  select distinct m.e164, c.sinyal
    from aawq_nomor m join aawq_aktif_wa c on c.e164 = m.e164
   where m.daftar_id = p_daftar and m.wa is true and not m.aktif_dinilai and m.kategori <> 'buang'
     and c.dicek_pada > now() - make_interval(days => p_umur_hari)
   limit greatest(p_n, 0)
$$;

create or replace function public.aawq_klaim_aktif(p_daftar uuid, p_n integer)
returns setof text language sql security definer set search_path = public as $$
  with calon as (
    select id from aawq_nomor
     where daftar_id = p_daftar and wa is true and not aktif_dinilai and kategori <> 'buang' and aktif_coba < 3
       and (aktif_klaim is null or aktif_klaim < now() - interval '5 minutes')
     order by id
     limit greatest(p_n, 0)
     for update skip locked
  )
  update aawq_nomor m set aktif_klaim = now() from calon where m.id = calon.id returning m.e164
$$;

create or replace function public.aawq_lepas_klaim_aktif(p_daftar uuid, p_e164 text[])
returns void language sql security definer set search_path = public as $$
  update aawq_nomor set aktif_klaim = null where daftar_id = p_daftar and e164 = any(p_e164) and not aktif_dinilai
$$;

-- Simpan penilaian: [{e164, sinyal: jsonb|null, skor: int|null, alasan: text[], dari_cache: bool}].
-- sinyal null = tidak pasti (dicoba lagi; setelah 3 kali dianggap selesai tanpa skor, tanpa vonis).
-- Alasan aktivitas lama diganti yang baru; skor/kategori nomor dihitung ulang; ringkasan daftar diperbarui.
create or replace function public.aawq_simpan_aktif(p_daftar uuid, p_hasil jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  create temporary table if not exists _aktif (e164 text primary key, sinyal jsonb, skor smallint, alasan text[], dari_cache boolean) on commit drop;
  truncate _aktif;
  insert into _aktif
  select distinct on (x.e164) x.e164, x.sinyal, x.skor, coalesce(x.alasan, '{}'), coalesce(x.dari_cache, false)
    from jsonb_to_recordset(p_hasil) as x(e164 text, sinyal jsonb, skor smallint, alasan text[], dari_cache boolean)
   where x.e164 is not null;

  insert into aawq_aktif_wa (e164, sinyal, dicek_pada)
  select e164, sinyal, now() from _aktif where sinyal is not null and not dari_cache
  on conflict (e164) do update set sinyal = excluded.sinyal, dicek_pada = excluded.dicek_pada;

  update aawq_nomor m set
    aktif_sinyal = a.sinyal,
    aktif_skor = a.skor,
    aktif_dinilai = true,
    aktif_klaim = null,
    alasan = (select coalesce(array_agg(x), '{}') from unnest(m.alasan) x where x not in ('aktivitas_rendah', 'kemungkinan_tidak_aktif', 'akun_bisnis')) || a.alasan
  from _aktif a
  where a.sinyal is not null and m.daftar_id = p_daftar and m.e164 = a.e164 and m.wa is true;

  update aawq_nomor m set
    aktif_coba = m.aktif_coba + 1,
    aktif_klaim = null,
    aktif_dinilai = m.aktif_coba + 1 >= 3
  from _aktif a
  where a.sinyal is null and m.daftar_id = p_daftar and m.e164 = a.e164 and not m.aktif_dinilai;

  update aawq_nomor set skor = aawq_skor(alasan), kategori = aawq_kategori(alasan)
   where daftar_id = p_daftar and e164 in (select e164 from _aktif) and (skor <> aawq_skor(alasan) or kategori <> aawq_kategori(alasan));
  perform aawq_hitung_ulang(p_daftar);
end
$$;

-- Kemajuan cek WhatsApp + skor aktif satu daftar.
create or replace function public.aawq_progres_wa(p_daftar uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sisa', count(*) filter (where wa is null and e164 is not null and kategori <> 'buang' and wa_coba < 3),
    'terdaftar', count(*) filter (where wa is true),
    'tidak_terdaftar', count(*) filter (where wa is false),
    'tidak_pasti', count(*) filter (where wa is null and wa_coba >= 3),
    'aktif_sisa', count(*) filter (where wa is true and not aktif_dinilai and kategori <> 'buang' and aktif_coba < 3),
    'aktif_dinilai', count(*) filter (where aktif_dinilai),
    'aktif_baik', count(*) filter (where aktif_dinilai and aktif_skor is not null and not (alasan && array['aktivitas_rendah', 'kemungkinan_tidak_aktif'])),
    'aktif_rendah', count(*) filter (where 'aktivitas_rendah' = any(alasan)),
    'tidak_aktif', count(*) filter (where 'kemungkinan_tidak_aktif' = any(alasan)),
    'bisnis', count(*) filter (where 'akun_bisnis' = any(alasan)),
    'skor_rata', round(avg(aktif_skor) filter (where aktif_skor is not null))
  ) from aawq_nomor where daftar_id = p_daftar
$$;

revoke all on function public.aawq_aktif_dari_cache(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.aawq_klaim_aktif(uuid, integer) from public, anon, authenticated;
revoke all on function public.aawq_lepas_klaim_aktif(uuid, text[]) from public, anon, authenticated;
revoke all on function public.aawq_simpan_aktif(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.aawq_progres_wa(uuid) from public, anon, authenticated;
grant execute on function public.aawq_aktif_dari_cache(uuid, integer, integer), public.aawq_klaim_aktif(uuid, integer),
  public.aawq_lepas_klaim_aktif(uuid, text[]), public.aawq_simpan_aktif(uuid, jsonb), public.aawq_progres_wa(uuid) to service_role;
grant all on public.aawq_aktif_wa to service_role;
