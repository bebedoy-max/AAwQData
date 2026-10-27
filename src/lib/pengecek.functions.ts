import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { wajibMasuk } from "./auth";

async function pastikanPerangkat(id: string, userId: string) {
  const { supabaseAdmin } = await import("./supabase.server");
  const { data, error } = await supabaseAdmin().from("aawq_pengecek").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) throw new Error("Perangkat tidak ditemukan");
  return data as { id: string; sesi: string; nama: string };
}

export const daftarPengecek = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { gatewayTerkonfigurasi } = await import("./gateway.server");
    const { aturanPengguna, segarkanStatus, pastikanPekerjaCekWa } = await import("./cek-wa.server");
    const { kesiapan } = await import("./jadwal-cek");
    pastikanPekerjaCekWa();
    const { data, error } = await supabaseAdmin().from("aawq_pengecek").select("*").eq("user_id", context.userId).order("dibuat");
    if (error) throw new Error(error.message);
    const perangkat = data ?? [];
    if (gatewayTerkonfigurasi()) await segarkanStatus(perangkat as never);
    const aturan = await aturanPengguna(context.userId);
    const sekarang = new Date();
    return {
      gateway: gatewayTerkonfigurasi(),
      aturan,
      perangkat: perangkat.map((p) => ({ ...p, kesiapan: kesiapan(p as never, aturan, sekarang) })),
    };
  });

export const tambahPengecek = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ nama: z.string().trim().min(1).max(60) }))
  .handler(async ({ data, context }) => {
    const crypto = await import("node:crypto");
    const { supabaseAdmin } = await import("./supabase.server");
    const { gateway } = await import("./gateway.server");
    const sesi = `aawq-${context.userId.slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}`;
    await gateway.buatSesi(sesi);
    await gateway.mulai(sesi);
    const { data: baris, error } = await supabaseAdmin().from("aawq_pengecek").insert({ user_id: context.userId, nama: data.nama, sesi, status: "STARTING" }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: baris.id as string };
  });

/** Status pemasangan: QR selama SCAN_QR_CODE; nomor tersimpan saat sudah WORKING. */
export const statusPemasangan = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { gateway, GalatGateway } = await import("./gateway.server");
    const p = await pastikanPerangkat(data.id, context.userId);
    const s = await gateway.sesi(p.sesi);
    let qr: string | null = null;
    if (s.status === "SCAN_QR_CODE") {
      try {
        qr = (await gateway.qr(p.sesi)).value;
      } catch (e) {
        if (!(e instanceof GalatGateway)) throw e;
      }
    } else if (s.status === "STOPPED" || s.status === "FAILED") {
      await gateway.mulai(p.sesi).catch(() => undefined);
    }
    await supabaseAdmin().from("aawq_pengecek").update({ status: s.status, nomor: s.me?.id?.split("@")[0] ?? null }).eq("id", p.id);
    return { status: s.status, nomor: s.me?.id?.split("@")[0] ?? null, qr };
  });

export const kodePairing = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ id: z.string().uuid(), nomor: z.string().regex(/^\+?[\d\s-]{8,20}$/, "Nomor tidak valid") }))
  .handler(async ({ data, context }) => {
    const { gateway } = await import("./gateway.server");
    const p = await pastikanPerangkat(data.id, context.userId);
    return gateway.kodePairing(p.sesi, data.nomor.replace(/\D/g, ""));
  });

export const ubahPengecek = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ id: z.string().uuid(), aktif: z.boolean().optional(), lepasTahan: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { gateway } = await import("./gateway.server");
    const p = await pastikanPerangkat(data.id, context.userId);
    const ubah: Record<string, unknown> = {};
    if (data.aktif !== undefined) ubah["aktif"] = data.aktif;
    if (data.lepasTahan) {
      await gateway.lepasBatasCek(p.sesi);
      Object.assign(ubah, { ditahan_sampai: null, alasan_tahan: null });
    }
    const { error } = await supabaseAdmin().from("aawq_pengecek").update(ubah).eq("id", p.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const hapusPengecek = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { gateway, GalatGateway } = await import("./gateway.server");
    const p = await pastikanPerangkat(data.id, context.userId);
    try {
      await gateway.hapus(p.sesi);
    } catch (e) {
      if (!(e instanceof GalatGateway && e.status === 404)) throw e;
    }
    await supabaseAdmin().from("aawq_pengecek").delete().eq("id", p.id);
    return { ok: true };
  });

export const simpanAturan = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(
    z.object({
      ukuran_kelompok: z.number().int().min(1).max(50),
      jeda_min_detik: z.number().int().min(3).max(3600),
      jeda_maks_detik: z.number().int().min(3).max(3600),
      batas_harian: z.number().int().min(0).max(1_000_000),
      umur_cache_hari: z.number().int().min(0).max(365),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { error } = await supabaseAdmin()
      .from("aawq_pengaturan")
      .upsert({ user_id: context.userId, ...data, jeda_maks_detik: Math.max(data.jeda_min_detik, data.jeda_maks_detik) });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Mulai/lanjutkan cek WhatsApp satu daftar: hasil cache diterapkan dulu, lalu pekerja latar mengambil sisanya. */
export const mulaiCekWa = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    const { aturanPengguna, pastikanPekerjaCekWa, selesaikanBilaHabis } = await import("./cek-wa.server");
    const { gatewayTerkonfigurasi } = await import("./gateway.server");
    if (!gatewayTerkonfigurasi()) throw new Error("Gateway belum diatur di server (WA_GATEWAY_URL, WA_GATEWAY_API_KEY).");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    if (daftar.status !== "selesai") throw new Error("Selesaikan analisis daftar dulu.");
    const db = supabaseAdmin();
    const aturan = await aturanPengguna(context.userId);
    const { data: dariCache, error } = await db.rpc("aawq_terapkan_cache_wa", { p_daftar: daftar.id, p_umur_hari: aturan.umur_cache_hari });
    if (error) throw new Error(error.message);
    await db.from("aawq_daftar").update({ cek_wa_status: "berjalan", cek_wa_mulai: new Date().toISOString(), cek_wa_selesai_pada: null }).eq("id", daftar.id);
    const selesai = await selesaikanBilaHabis(daftar.id);
    pastikanPekerjaCekWa();
    return { dariCache: Number(dariCache) || 0, selesai };
  });

export const jedaCekWa = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    await pastikanPemilik(data.daftarId, context.userId);
    await supabaseAdmin().from("aawq_daftar").update({ cek_wa_status: "jeda" }).eq("id", data.daftarId).eq("cek_wa_status", "berjalan");
    return { ok: true };
  });

export const progresCekWa = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    const { aturanPengguna, pastikanPekerjaCekWa } = await import("./cek-wa.server");
    const { kesiapan, perkiraanDetik } = await import("./jadwal-cek");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    const db = supabaseAdmin();
    const { data: progres, error } = await db.rpc("aawq_progres_wa", { p_daftar: daftar.id });
    if (error) throw new Error(error.message);
    const { data: perangkat } = await db.from("aawq_pengecek").select("aktif, status, ditahan_sampai, hari, cek_hari_ini").eq("user_id", context.userId);
    const aturan = await aturanPengguna(context.userId);
    const sekarang = new Date();
    const siap = (perangkat ?? []).filter((p) => kesiapan(p as never, aturan, sekarang).siap).length;
    const p = progres as { sisa: number; terdaftar: number; tidak_terdaftar: number; tidak_pasti: number };
    if ((daftar as { cek_wa_status?: string }).cek_wa_status === "berjalan") pastikanPekerjaCekWa();
    return {
      status: (daftar as { cek_wa_status?: string }).cek_wa_status ?? "belum",
      ...p,
      perangkatSiap: siap,
      perangkatTotal: perangkat?.length ?? 0,
      perkiraanDetik: perkiraanDetik(p.sisa, siap, aturan),
      daftar: { jumlah_siap: daftar.jumlah_siap, jumlah_ragu: daftar.jumlah_ragu, jumlah_buang: daftar.jumlah_buang, jumlah_total: daftar.jumlah_total },
    };
  });
