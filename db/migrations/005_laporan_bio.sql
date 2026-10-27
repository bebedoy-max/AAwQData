-- AAwQData 005: Laporan Bio (status About, akun bisnis per level, tahun sertifikat bisnis) per daftar.
--
-- Dihitung dari hasil cek WhatsApp yang sudah ada (kolom wa dan aktif_sinyal), tanpa kueri tambahan ke WhatsApp.
-- Level dan tahun bisnis berasal dari sertifikat nama bisnis (aktif_sinyal.bisnisVn) yang dibaca gateway sejak
-- versi yang mengirim bisnisVn; nomor yang dinilai sebelum itu tercatat bisnis tanpa level ("tidak diketahui").
-- Aman dijalankan ulang.

-- Teks About bawaan WhatsApp (sama dengan ABOUT_BAWAAN di src/lib/aktivitas.ts; dites agar tetap sama).
create or replace function public.aawq_about_bawaan(p_teks text) returns boolean
language sql immutable as $$
  select coalesce(btrim(p_teks) ~* '^(hey there! i am using whatsapp\.?|available|disponível|disponivel|disponible|ada|tersedia|halo! saya menggunakan whatsapp\.?|olá! eu estou usando o whatsapp\.?|ola! eu estou usando o whatsapp\.?|hola, estoy usando whatsapp\.?|busy|sibuk|ocupado|at work|di kantor|no trabalho|en el trabajo|urgent calls only|hanya panggilan darurat|somente ligações urgentes|battery about to die|can''?t talk,? whatsapp only|in a meeting|sleeping|at school|at the gym|at the movies)$', false)
$$;

create or replace function public.aawq_laporan_bio(p_daftar uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with n as (
    select wa, aktif_sinyal as s, e164 from aawq_nomor where daftar_id = p_daftar
  ), t as (
    select
      count(*) as total,
      count(*) filter (where e164 is not null) as nomor_valid,
      count(*) filter (where wa is true) as terdaftar,
      count(*) filter (where wa is false) as tidak_terdaftar,
      count(*) filter (where e164 is not null and wa is null) as belum_pasti,
      count(*) filter (where wa is true and s is not null) as dinilai,
      count(*) filter (where wa is true and s->'about'->>'status' = 'ada' and not aawq_about_bawaan(s->'about'->>'teks')) as bio_sendiri,
      count(*) filter (where wa is true and s->'about'->>'status' = 'ada' and aawq_about_bawaan(s->'about'->>'teks')) as bio_bawaan,
      count(*) filter (where wa is true and s->'about'->>'status' = 'kosong') as bio_kosong,
      count(*) filter (where wa is true and s->'about'->>'status' = 'tersembunyi') as bio_tersembunyi,
      count(*) filter (where wa is true and s is not null and coalesce(jsonb_typeof(s->'about'), 'null') = 'null') as bio_tidak_terbaca,
      count(*) filter (where wa is true and (s->>'business') = 'true') as bisnis,
      count(*) filter (where wa is true and (s->>'business') = 'false') as pribadi,
      count(*) filter (where wa is true and s->>'picture' = 'ada') as foto_ada
    from n
  )
  select to_jsonb(t) || jsonb_build_object(
    'level', coalesce((
      select jsonb_object_agg(lv, c) from (
        select coalesce(nullif(s->'bisnisVn'->>'level', ''), 'tidak diketahui') as lv, count(*) as c
          from n where wa is true and (s->>'business') = 'true' group by 1
      ) x), '{}'::jsonb),
    'tahun', coalesce((
      select jsonb_object_agg(th, c order by th) from (
        select extract(year from (s->'bisnisVn'->>'sejak')::timestamptz)::int::text as th, count(*) as c
          from n where wa is true and (s->>'business') = 'true' and s->'bisnisVn'->>'sejak' is not null group by 1
      ) y), '{}'::jsonb)
  )
  from t
$$;

-- Nomor bisnis satu level (per halaman, keyset pada id) untuk tampilan dan unduhan laporan.
create or replace function public.aawq_laporan_bisnis(p_daftar uuid, p_level text, p_setelah bigint default 0, p_n integer default 500)
returns table (id bigint, e164 text, level text, nama text, sejak timestamptz)
language sql stable security definer set search_path = public as $$
  select n.id, n.e164,
         coalesce(nullif(n.aktif_sinyal->'bisnisVn'->>'level', ''), 'tidak diketahui'),
         n.aktif_sinyal->'bisnisVn'->>'nama',
         (n.aktif_sinyal->'bisnisVn'->>'sejak')::timestamptz
    from aawq_nomor n
   where n.daftar_id = p_daftar and n.wa is true and (n.aktif_sinyal->>'business') = 'true'
     and coalesce(nullif(n.aktif_sinyal->'bisnisVn'->>'level', ''), 'tidak diketahui') = p_level
     and n.id > p_setelah
   order by n.id
   limit least(greatest(p_n, 1), 5000)
$$;

revoke all on function public.aawq_laporan_bio(uuid) from public, anon, authenticated;
revoke all on function public.aawq_laporan_bisnis(uuid, text, bigint, integer) from public, anon, authenticated;
grant execute on function public.aawq_laporan_bio(uuid) to service_role;
grant execute on function public.aawq_laporan_bisnis(uuid, text, bigint, integer) to service_role;

notify pgrst, 'reload schema';
