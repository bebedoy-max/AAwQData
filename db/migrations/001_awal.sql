-- AAwQData 001: daftar nomor, hasil pemeriksaan per nomor, dan analisis tingkat daftar.
-- Aditif dan aman dijalankan ulang. Dijalankan manual oleh pemilik di Supabase (SQL editor / psql).

create extension if not exists pgcrypto;

create table if not exists public.aawq_daftar (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nama text not null,
  negara_target text[] not null default '{}',
  koreksi_kode_negara boolean not null default true,
  status text not null default 'mengunggah' check (status in ('mengunggah', 'menganalisis', 'selesai', 'gagal')),
  jumlah_total integer not null default 0,
  jumlah_siap integer not null default 0,
  jumlah_ragu integer not null default 0,
  jumlah_buang integer not null default 0,
  galat text,
  dibuat timestamptz not null default now(),
  selesai_pada timestamptz
);
create index if not exists aawq_daftar_user_idx on public.aawq_daftar (user_id, dibuat desc);

create table if not exists public.aawq_nomor (
  id bigint generated always as identity primary key,
  daftar_id uuid not null references public.aawq_daftar(id) on delete cascade,
  baris integer not null,
  mentah text not null,
  e164 text,
  negara text,
  tipe text,
  alasan text[] not null default '{}',
  koreksi_dari text,
  skor smallint not null,
  kategori text not null check (kategori in ('siap', 'ragu', 'buang'))
);
-- Unik: potongan unggahan yang dikirim ulang (koneksi putus) tidak menggandakan baris.
create unique index if not exists aawq_nomor_daftar_baris_idx on public.aawq_nomor (daftar_id, baris);
create index if not exists aawq_nomor_daftar_kategori_idx on public.aawq_nomor (daftar_id, kategori, baris);
create index if not exists aawq_nomor_daftar_e164_idx on public.aawq_nomor (daftar_id, e164) where e164 is not null;

-- Data hanya dibaca/ditulis lewat fungsi server (service role) yang memeriksa pemilik. RLS tetap aktif sebagai
-- lapisan kedua: pengguna yang masuk hanya bisa MEMBACA daftar miliknya sendiri, tidak bisa menulis langsung.
alter table public.aawq_daftar enable row level security;
alter table public.aawq_nomor enable row level security;
drop policy if exists aawq_daftar_baca_sendiri on public.aawq_daftar;
create policy aawq_daftar_baca_sendiri on public.aawq_daftar for select to authenticated using (user_id = auth.uid());
drop policy if exists aawq_nomor_baca_sendiri on public.aawq_nomor;
create policy aawq_nomor_baca_sendiri on public.aawq_nomor for select to authenticated
  using (exists (select 1 from public.aawq_daftar d where d.id = daftar_id and d.user_id = auth.uid()));

-- Skor dan kategori dari daftar alasan. Bobot SAMA dengan ALASAN di src/lib/kualitas.ts (tes kualitas.sql.test.ts
-- memeriksa keduanya tetap selaras).
create or replace function public.aawq_bobot(p_alasan text) returns integer
language sql immutable parallel safe as $$
  select case p_alasan
    when 'kosong' then 100 when 'bukan_nomor' then 100 when 'tidak_valid' then 100 when 'negara_lain' then 80
    when 'kode_negara_dikoreksi' then 25 when 'telepon_rumah' then 70 when 'nomor_khusus' then 80
    when 'tipe_tidak_dikenal' then 20 when 'pola_berulang' then 40 when 'pola_urut' then 40
    when 'duplikat' then 100 when 'deret_berurutan' then 30 else 0 end
$$;

create or replace function public.aawq_skor(p_alasan text[]) returns smallint
language sql immutable parallel safe as $$
  select greatest(0, 100 - coalesce((select sum(public.aawq_bobot(a)) from (select distinct unnest(p_alasan) as a) u), 0))::smallint
$$;

create or replace function public.aawq_kategori(p_alasan text[]) returns text
language sql immutable parallel safe as $$
  select case
    when p_alasan && array['kosong', 'bukan_nomor', 'tidak_valid', 'negara_lain', 'telepon_rumah', 'nomor_khusus', 'duplikat'] then 'buang'
    when cardinality(p_alasan) > 0 then 'ragu'
    else 'siap' end
$$;

-- Analisis tingkat daftar setelah semua nomor masuk: duplikat (kemunculan kedua dst. dibuang) dan deret nomor
-- berselisih 1 sepanjang >= p_deret_min (ciri daftar hasil generator). Aman diulang: alasan tingkat daftar dihapus dulu.
create or replace function public.aawq_analisis_daftar(p_daftar uuid, p_deret_min integer default 10)
returns void language plpgsql security definer set search_path = public as $$
begin
  update aawq_daftar set status = 'menganalisis', galat = null where id = p_daftar;
  -- Baris baru saja masuk massal: tanpa statistik segar perencana memilih rencana buruk (30 dtk vs 0,4 dtk).
  analyze public.aawq_nomor;

  update aawq_nomor n
     set alasan = array_remove(array_remove(n.alasan, 'duplikat'), 'deret_berurutan')
   where n.daftar_id = p_daftar and n.alasan && array['duplikat', 'deret_berurutan'];

  with urut as (
    select id, row_number() over (partition by e164 order by baris, id) as ke
      from aawq_nomor where daftar_id = p_daftar and e164 is not null
  )
  update aawq_nomor n set alasan = n.alasan || 'duplikat'::text
    from urut where n.id = urut.id and urut.ke > 1;

  with unik as (
    select id, e164::numeric as v from aawq_nomor
     where daftar_id = p_daftar and e164 is not null and not ('duplikat' = any(alasan))
  ), pulau as (
    select id, v - row_number() over (order by v) as grup from unik
  ), panjang as (
    select grup from pulau group by grup having count(*) >= greatest(p_deret_min, 3)
  )
  update aawq_nomor n set alasan = n.alasan || 'deret_berurutan'::text
    from pulau p where n.id = p.id and p.grup in (select grup from panjang);

  -- Hitung ulang skor/kategori hanya untuk baris yang skornya tidak lagi sesuai alasannya.
  update aawq_nomor n set skor = aawq_skor(n.alasan), kategori = aawq_kategori(n.alasan)
   where n.daftar_id = p_daftar and (n.skor <> aawq_skor(n.alasan) or n.kategori <> aawq_kategori(n.alasan));

  update aawq_daftar d set
    jumlah_total = s.total, jumlah_siap = s.siap, jumlah_ragu = s.ragu, jumlah_buang = s.buang,
    status = 'selesai', selesai_pada = now()
  from (
    select count(*) as total,
           count(*) filter (where kategori = 'siap') as siap,
           count(*) filter (where kategori = 'ragu') as ragu,
           count(*) filter (where kategori = 'buang') as buang
      from aawq_nomor where daftar_id = p_daftar
  ) s
  where d.id = p_daftar;
end
$$;

-- Simpan satu potongan hasil pemeriksaan (array JSON) sekaligus. Lewat RPC, bukan insert/upsert supabase-js: klien
-- itu mengumpulkan nama kolom dari setiap baris secara kuadratik (puluhan detik per 5.000 baris). Baris yang sudah
-- ada (potongan dikirim ulang) diabaikan. Mengembalikan jumlah baris baru.
create or replace function public.aawq_simpan_nomor(p_baris jsonb)
returns integer language sql security definer set search_path = public as $$
  with ins as (
    insert into aawq_nomor (daftar_id, baris, mentah, e164, negara, tipe, alasan, koreksi_dari, skor, kategori)
    select daftar_id, baris, mentah, e164, negara, tipe, alasan, koreksi_dari, skor, kategori
      from jsonb_populate_recordset(null::aawq_nomor, p_baris)
    on conflict (daftar_id, baris) do nothing
    returning 1
  )
  select count(*)::integer from ins
$$;

-- Ringkasan untuk halaman detail: per kategori, per alasan, per negara, jumlah dikoreksi.
create or replace function public.aawq_ringkasan(p_daftar uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kategori', (select coalesce(jsonb_object_agg(kategori, n), '{}') from (select kategori, count(*) n from aawq_nomor where daftar_id = p_daftar group by 1) k),
    'alasan', (select coalesce(jsonb_object_agg(a, n), '{}') from (select unnest(alasan) a, count(*) n from aawq_nomor where daftar_id = p_daftar group by 1) x),
    'negara', (select coalesce(jsonb_agg(jsonb_build_object('negara', negara, 'jumlah', n) order by n desc), '[]')
                 from (select coalesce(negara, '?') negara, count(*) n from aawq_nomor where daftar_id = p_daftar group by 1 order by 2 desc limit 15) g),
    'dikoreksi', (select count(*) from aawq_nomor where daftar_id = p_daftar and koreksi_dari is not null)
  )
$$;

-- Fungsi di atas hanya untuk server (service role).
revoke all on function public.aawq_analisis_daftar(uuid, integer) from public, anon, authenticated;
revoke all on function public.aawq_ringkasan(uuid) from public, anon, authenticated;
revoke all on function public.aawq_simpan_nomor(jsonb) from public, anon, authenticated;
grant execute on function public.aawq_simpan_nomor(jsonb) to service_role;
grant execute on function public.aawq_analisis_daftar(uuid, integer) to service_role;
grant execute on function public.aawq_ringkasan(uuid) to service_role;
grant all on public.aawq_daftar, public.aawq_nomor to service_role;
grant select on public.aawq_daftar, public.aawq_nomor to authenticated;
