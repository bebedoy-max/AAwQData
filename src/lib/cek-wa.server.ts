/**
 * Pekerja latar cek WhatsApp: berjalan di proses server AAwQData (satu instance).
 *
 * Setiap 2 detik: untuk setiap perangkat pengecek yang siap dan sudah lewat jedanya, ambil (klaim) satu kelompok
 * nomor dari daftar berjalan milik pemilik perangkat itu, tanyakan ke gateway, simpan hasilnya. Hasil "tidak pasti"
 * tidak pernah dianggap "tidak terdaftar". Perangkat yang dibatasi WhatsApp ditahan sampai waktu dari gateway, nomor
 * yang sedang diklaim dikembalikan ke antrean, dan perangkat lain tetap bekerja.
 */
import { ATURAN_BAWAAN, cekHariIni, hariWib, jedaBerikut, kesiapan, type AturanCek } from "./jadwal-cek";
import { GalatGateway, gateway, gatewayTerkonfigurasi } from "./gateway.server";
import { supabaseAdmin } from "./supabase.server";

interface BarisPengecek {
  id: string;
  user_id: string;
  sesi: string;
  nama: string;
  aktif: boolean;
  status: string;
  ditahan_sampai: string | null;
  hari: string;
  cek_hari_ini: number;
  total_cek: number;
}

const keadaan = new Map<string, { berikut: number; sibuk: boolean }>();
const giliran = new Map<string, number>();
let dimulai = false;
let detakSibuk = false;
let terakhirSegar = 0;

export function pastikanPekerjaCekWa(): void {
  if (dimulai || !gatewayTerkonfigurasi()) return;
  dimulai = true;
  const t = setInterval(() => {
    void detak().catch((e) => console.error("[cek-wa] detak gagal:", (e as Error).message));
  }, 2000);
  t.unref?.();
}

export async function aturanPengguna(userId: string): Promise<AturanCek> {
  const { data } = await supabaseAdmin().from("aawq_pengaturan").select("*").eq("user_id", userId).maybeSingle();
  return { ...ATURAN_BAWAAN, ...(data ?? {}) };
}

/** Status perangkat dari gateway -> database (untuk tampilan dan kesiapan). */
export async function segarkanStatus(perangkat: BarisPengecek[]): Promise<void> {
  await Promise.all(
    perangkat.map(async (p) => {
      try {
        const s = await gateway.sesi(p.sesi);
        const batas = s.checkLimit?.until ?? s.restriction?.until ?? null;
        const ubah: Record<string, unknown> = { status: s.status, nomor: s.me?.id?.split("@")[0] ?? null };
        if (batas && Date.parse(batas) > Date.now()) Object.assign(ubah, { ditahan_sampai: batas, alasan_tahan: s.checkLimit?.reason ?? s.restriction?.reason ?? null });
        await supabaseAdmin().from("aawq_pengecek").update(ubah).eq("id", p.id);
        p.status = s.status;
        if (ubah["ditahan_sampai"]) p.ditahan_sampai = String(ubah["ditahan_sampai"]);
      } catch (e) {
        const status = e instanceof GalatGateway && e.status === 404 ? "HILANG" : "TIDAK_TERJANGKAU";
        await supabaseAdmin().from("aawq_pengecek").update({ status }).eq("id", p.id);
        p.status = status;
      }
    }),
  );
}

async function detak(): Promise<void> {
  if (detakSibuk) return;
  detakSibuk = true;
  try {
    const db = supabaseAdmin();
    const { data: daftar } = await db.from("aawq_daftar").select("id, user_id").eq("cek_wa_status", "berjalan").order("cek_wa_mulai");
    if (!daftar?.length) return;
    const pemilik = [...new Set(daftar.map((d) => d.user_id as string))];
    const { data: perangkat } = await db.from("aawq_pengecek").select("*").in("user_id", pemilik).eq("aktif", true);
    if (!perangkat?.length) return;
    if (Date.now() - terakhirSegar > 30_000) {
      terakhirSegar = Date.now();
      await segarkanStatus(perangkat as BarisPengecek[]);
    }
    const aturan = new Map<string, AturanCek>();
    for (const u of pemilik) aturan.set(u, await aturanPengguna(u));
    const sekarang = new Date();
    for (const p of perangkat as BarisPengecek[]) {
      const st = keadaan.get(p.id) ?? { berikut: 0, sibuk: false };
      keadaan.set(p.id, st);
      if (st.sibuk || st.berikut > sekarang.getTime()) continue;
      const a = aturan.get(p.user_id)!;
      if (!kesiapan(p, a, sekarang).siap) continue;
      const milik = daftar.filter((d) => d.user_id === p.user_id).map((d) => d.id as string);
      // Bergiliran antar daftar milik pengguna yang sama.
      const g = giliran.get(p.user_id) ?? 0;
      giliran.set(p.user_id, g + 1);
      const daftarId = milik[g % milik.length]!;
      st.sibuk = true;
      void kerjakan(p, daftarId, a, st)
        .catch((e) => {
          console.error(`[cek-wa] ${p.nama}:`, (e as Error).message);
          st.berikut = Date.now() + 30_000;
        })
        .finally(() => {
          st.sibuk = false;
        });
    }
  } finally {
    detakSibuk = false;
  }
}

async function kerjakan(p: BarisPengecek, daftarId: string, a: AturanCek, st: { berikut: number }): Promise<void> {
  const db = supabaseAdmin();
  const { data: klaim, error } = await db.rpc("aawq_klaim_wa", { p_daftar: daftarId, p_n: a.ukuran_kelompok });
  if (error) throw new Error(error.message);
  const nomor = (klaim ?? []) as string[];
  if (!nomor.length) {
    await selesaikanBilaHabis(daftarId);
    st.berikut = Date.now() + 2000;
    return;
  }
  try {
    const r = await gateway.cek(p.sesi, nomor);
    const peta = new Map(r.results.map((x) => [x.phone, x.numberExists]));
    const hasil = nomor.map((e164) => ({ e164, terdaftar: peta.get(e164) ?? null }));
    const { error: e2 } = await db.rpc("aawq_simpan_cek_wa", { p_daftar: daftarId, p_hasil: hasil });
    if (e2) throw new Error(e2.message);
    const sekarang = new Date();
    await db
      .from("aawq_pengecek")
      .update({
        hari: hariWib(sekarang),
        cek_hari_ini: cekHariIni(p, sekarang) + nomor.length,
        total_cek: Number(p.total_cek) + nomor.length,
        terakhir_cek: sekarang.toISOString(),
        ditahan_sampai: null,
        alasan_tahan: null,
      })
      .eq("id", p.id);
    st.berikut = Date.now() + jedaBerikut(a);
  } catch (e) {
    await db.rpc("aawq_lepas_klaim_wa", { p_daftar: daftarId, p_e164: nomor });
    const status = e instanceof GalatGateway ? e.status : 0;
    if (status === 503) {
      // Dibatasi WhatsApp (nomor kontrol tidak terbaca / kueri ditolak): tahan sesuai gateway, minimal 30 menit.
      let sampai = Date.now() + 30 * 60_000;
      try {
        const s = await gateway.sesi(p.sesi);
        const t = Date.parse(s.checkLimit?.until ?? s.restriction?.until ?? "");
        if (Number.isFinite(t) && t > Date.now()) sampai = t;
      } catch {
        /* pakai bawaan */
      }
      await db.from("aawq_pengecek").update({ ditahan_sampai: new Date(sampai).toISOString(), alasan_tahan: (e as Error).message.slice(0, 300) }).eq("id", p.id);
      st.berikut = sampai;
    } else if (status === 422) {
      await db.from("aawq_pengecek").update({ status: "TIDAK_SIAP" }).eq("id", p.id);
      st.berikut = Date.now() + 60_000;
    } else if (status === 429) {
      st.berikut = Date.now() + 5000;
    } else {
      throw e;
    }
  }
}

/** Daftar selesai bila tidak ada lagi nomor yang perlu dicek (klaim yang sedang berjalan masih terhitung sisa). */
export async function selesaikanBilaHabis(daftarId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data } = await db.rpc("aawq_progres_wa", { p_daftar: daftarId });
  if ((data as { sisa: number } | null)?.sisa !== 0) return false;
  await db.from("aawq_daftar").update({ cek_wa_status: "selesai", cek_wa_selesai_pada: new Date().toISOString() }).eq("id", daftarId).eq("cek_wa_status", "berjalan");
  return true;
}
