import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { wajibMasuk } from "./auth";

async function pastikanPerangkat(id: string, userId: string) {
  const { supabaseAdmin } = await import("./supabase.server");
  const { data, error } = await supabaseAdmin().from("aawq_pengecek").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) throw new Error("Perangkat tidak ditemukan");
  return data as { id: string; sesi: string; nama: string; sumber: string; gateway: string | null };
}

/** Pemasangan dan penghapusan sesi hanya untuk perangkat nq-gate; perangkat WSPRO milik worker tidak boleh diubah. */
function hanyaNq(p: { sumber: string }) {
  if (p.sumber === "aabaileys") throw new Error("Perangkat ini milik WSPRO: tidak bisa dipasangkan ulang atau dihapus dari AAwQData.");
}

let terakhirSinkron = 0;

export const daftarPengecek = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { sumberTerkonfigurasi } = await import("./gateway.server");
    const { aturanPengguna, segarkanStatus, pastikanPekerjaCekWa, sinkronWspro } = await import("./cek-wa.server");
    const { kesiapan } = await import("./jadwal-cek");
    pastikanPekerjaCekWa();
    const aturan = await aturanPengguna(context.userId);
    const sumber = aturan.sumber_gateway;
    const terkonfigurasi = sumberTerkonfigurasi(sumber);
    let galatSinkron: string[] = [];
    // WSPRO: satu permintaan daftar sesi per gateway (paling sering tiap 20 dtk), bukan satu per perangkat.
    if (sumber === "aabaileys" && terkonfigurasi && Date.now() - terakhirSinkron > 20_000) {
      terakhirSinkron = Date.now();
      galatSinkron = (await sinkronWspro(context.userId)).galat;
    }
    let { data, error } = await supabaseAdmin()
      .from("aawq_pengecek")
      .select("*")
      .eq("user_id", context.userId)
      .eq("sumber", sumber)
      .order("dibuat");
    // Sebelum migrasi 006 kolom sumber belum ada: semua perangkat adalah perangkat nq-gate.
    if (error && /sumber/.test(error.message) && sumber === "nq") {
      ({ data, error } = await supabaseAdmin().from("aawq_pengecek").select("*").eq("user_id", context.userId).order("dibuat"));
    }
    if (error) throw new Error(error.message);
    const perangkat = data ?? [];
    if (sumber === "nq" && terkonfigurasi) await segarkanStatus(perangkat as never);
    const sekarang = new Date();
    return {
      gateway: terkonfigurasi,
      sumber,
      galatSinkron,
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
    hanyaNq(p);
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
    hanyaNq(p);
    return gateway.kodePairing(p.sesi, data.nomor.replace(/\D/g, ""));
  });

export const ubahPengecek = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ id: z.string().uuid(), aktif: z.boolean().optional(), lepasTahan: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { klienPerangkat } = await import("./gateway.server");
    const p = await pastikanPerangkat(data.id, context.userId);
    const ubah: Record<string, unknown> = {};
    if (data.aktif !== undefined) ubah["aktif"] = data.aktif;
    if (data.lepasTahan) {
      await klienPerangkat(p).lepasBatasCek(p.sesi);
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
    hanyaNq(p);
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
      cek_aktivitas: z.boolean(),
      cek_foto: z.boolean(),
      cek_bisnis: z.boolean(),
      ambang_ragu: z.number().int().min(0).max(100),
      ambang_buang: z.number().int().min(0).max(100),
      bisnis: z.enum(["ragu", "biarkan"]),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { error } = await supabaseAdmin()
      .from("aawq_pengaturan")
      .upsert({
        user_id: context.userId,
        ...data,
        jeda_maks_detik: Math.max(data.jeda_min_detik, data.jeda_maks_detik),
        ambang_buang: Math.min(data.ambang_buang, data.ambang_ragu),
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Mulai/lanjutkan cek WhatsApp satu daftar: hasil cache diterapkan dulu, lalu pekerja latar mengambil sisanya. */
export const mulaiCekWa = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    const { aturanPengguna, nilaiDariCache, pastikanPekerjaCekWa, selesaikanBilaHabis } = await import("./cek-wa.server");
    const { sumberTerkonfigurasi } = await import("./gateway.server");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    if (daftar.status !== "selesai") throw new Error("Selesaikan analisis daftar dulu.");
    const db = supabaseAdmin();
    const aturan = await aturanPengguna(context.userId);
    if (!sumberTerkonfigurasi(aturan.sumber_gateway)) {
      throw new Error(
        aturan.sumber_gateway === "nq"
          ? "Gateway nq-gate belum diatur di server (WA_GATEWAY_URL, WA_GATEWAY_API_KEY)."
          : "Gateway WSPRO belum diatur di server (WSPRO_GATEWAYS).",
      );
    }
    const { data: dariCache, error } = await db.rpc("aawq_terapkan_cache_wa", { p_daftar: daftar.id, p_umur_hari: aturan.umur_cache_hari });
    if (error) throw new Error(error.message);
    await db.from("aawq_daftar").update({ cek_wa_status: "berjalan", cek_wa_mulai: new Date().toISOString(), cek_wa_selesai_pada: null }).eq("id", daftar.id);
    const aktifDariCache = aturan.cek_aktivitas ? await nilaiDariCache(daftar.id, aturan) : 0;
    const selesai = await selesaikanBilaHabis(daftar.id, aturan);
    pastikanPekerjaCekWa();
    return { dariCache: (Number(dariCache) || 0) + aktifDariCache, selesai };
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
    const { kesiapan, perkiraanDetik, ukuranKelompokAktif } = await import("./jadwal-cek");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    const db = supabaseAdmin();
    const { data: progres, error } = await db.rpc("aawq_progres_wa", { p_daftar: daftar.id });
    if (error) throw new Error(error.message);
    const aturan = await aturanPengguna(context.userId);
    const { data: perangkat } = await db
      .from("aawq_pengecek")
      .select("aktif, status, ditahan_sampai, hari, cek_hari_ini")
      .eq("user_id", context.userId)
      .eq("sumber", aturan.sumber_gateway);
    const sekarang = new Date();
    const siap = (perangkat ?? []).filter((p) => kesiapan(p as never, aturan, sekarang).siap).length;
    const p = progres as {
      sisa: number;
      terdaftar: number;
      tidak_terdaftar: number;
      tidak_pasti: number;
      aktif_sisa: number;
      aktif_dinilai: number;
      aktif_baik: number;
      aktif_rendah: number;
      tidak_aktif: number;
      bisnis: number;
      skor_rata: number | null;
    };
    // Perkiraan: nomor fase 1 + (bila aktif) perkiraan fase 2 untuk nomor yang belum dicek, disetarakan ke ukuran kelompok fase 1.
    const fase2 = aturan.cek_aktivitas ? ((p.aktif_sisa + p.sisa) * aturan.ukuran_kelompok) / ukuranKelompokAktif(aturan) : 0;
    if ((daftar as { cek_wa_status?: string }).cek_wa_status === "berjalan") pastikanPekerjaCekWa();
    // Grade A/B/C (migrasi 007); null bila migrasi belum dijalankan.
    const { data: gradeData, error: gradeError } = await db.rpc("aawq_grade_wa", {
      p_daftar: daftar.id,
      p_a_hari: aturan.grade_a_hari,
      p_b_hari: aturan.grade_b_hari,
    });
    const grade = gradeError ? null : (gradeData as { a: number; b: number; c: number });
    return {
      grade,
      gradeHari: { a: aturan.grade_a_hari, b: aturan.grade_b_hari },
      status: (daftar as { cek_wa_status?: string }).cek_wa_status ?? "belum",
      ...p,
      perangkatSiap: siap,
      perangkatTotal: perangkat?.length ?? 0,
      perkiraanDetik: perkiraanDetik(Math.ceil(p.sisa + fase2), siap, aturan),
      cekAktivitas: aturan.cek_aktivitas,
      daftar: { jumlah_siap: daftar.jumlah_siap, jumlah_ragu: daftar.jumlah_ragu, jumlah_buang: daftar.jumlah_buang, jumlah_total: daftar.jumlah_total },
    };
  });

/** Lepaskan semua perangkat reader WSPRO ke posisi nonaktif sementara. */
export const aturSemuaWspro = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ aktif: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    let q = supabaseAdmin().from("aawq_pengecek").update({ aktif: data.aktif }).eq("user_id", context.userId).eq("sumber", "aabaileys");
    if (data.aktif) q = q.eq("status", "WORKING");
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Segarkan reader WSPRO: sinkronkan ke keadaan gateway, lalu jadikan reader PERSIS perangkat yang sedang tersambung
 * dan tidak sedang dibatasi WhatsApp. Perangkat yang terputus dibuang dari daftar (muncul lagi bila tersambung
 * kembali), perangkat yang dibatasi dinonaktifkan. Jadi jumlah reader dinamis tiap kali ditekan.
 */
export const segarkanReaderWspro = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { sinkronWspro } = await import("./cek-wa.server");
    const uid = context.userId;
    const sync = await sinkronWspro(uid);
    const db = supabaseAdmin();
    const sekarang = new Date().toISOString();
    // 1) Buang perangkat yang tidak lagi tersambung (akan masuk lagi otomatis bila tersambung kembali).
    const { error: e1, count: dibuang } = await db.from("aawq_pengecek").delete({ count: "exact" }).eq("user_id", uid).eq("sumber", "aabaileys").neq("status", "WORKING");
    if (e1) throw new Error(e1.message);
    // 2) Aktifkan semua yang tersambung sebagai reader, lalu matikan yang sedang dibatasi WhatsApp.
    const { error: e2 } = await db.from("aawq_pengecek").update({ aktif: true }).eq("user_id", uid).eq("sumber", "aabaileys").eq("status", "WORKING");
    if (e2) throw new Error(e2.message);
    const { error: e3 } = await db.from("aawq_pengecek").update({ aktif: false }).eq("user_id", uid).eq("sumber", "aabaileys").gt("ditahan_sampai", sekarang);
    if (e3) throw new Error(e3.message);
    const { count: reader } = await db.from("aawq_pengecek").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("sumber", "aabaileys").eq("aktif", true);
    return { reader: reader ?? 0, dibuang: dibuang ?? 0, galat: sync.galat };
  });

/** Menu Pengaturan: sumber reader yang dipakai + status konfigurasi tiap sumber di server. */
export const bacaPengaturanSumber = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .handler(async ({ context }) => {
    const { gatewayNq, gatewayWspro } = await import("./gateway.server");
    const { aturanPengguna } = await import("./cek-wa.server");
    const aturan = await aturanPengguna(context.userId);
    const nq = gatewayNq();
    return {
      sumber: aturan.sumber_gateway,
      grade: { a: aturan.grade_a_hari, b: aturan.grade_b_hari },
      nq: { terkonfigurasi: !!nq, url: nq?.url ?? null },
      wspro: { terkonfigurasi: gatewayWspro().length > 0, url: gatewayWspro().map((g) => g.url) },
    };
  });

export const simpanSumber = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ sumber: z.enum(["nq", "aabaileys"]) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const db = supabaseAdmin();
    const { data: ada } = await db.from("aawq_pengaturan").select("user_id").eq("user_id", context.userId).maybeSingle();
    const { error } = ada
      ? await db.from("aawq_pengaturan").update({ sumber_gateway: data.sumber }).eq("user_id", context.userId)
      : await db.from("aawq_pengaturan").insert({ user_id: context.userId, sumber_gateway: data.sumber });
    if (error) throw new Error(/sumber_gateway/.test(error.message) ? "Jalankan migrasi 006_sumber_reader.sql dulu." : error.message);
    if (data.sumber === "aabaileys") {
      const { sinkronWspro } = await import("./cek-wa.server");
      await sinkronWspro(context.userId).catch(() => undefined);
    }
    return { ok: true };
  });

/** Batas hari grade aktivitas (Pengaturan). */
export const simpanGrade = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ a: z.number().int().min(1).max(365), b: z.number().int().min(1).max(3650) }))
  .handler(async ({ data, context }) => {
    if (data.b <= data.a) throw new Error("Batas grade B harus lebih besar dari batas grade A.");
    const { supabaseAdmin } = await import("./supabase.server");
    const db = supabaseAdmin();
    const isi = { grade_a_hari: data.a, grade_b_hari: data.b };
    const { data: ada } = await db.from("aawq_pengaturan").select("user_id").eq("user_id", context.userId).maybeSingle();
    const { error } = ada
      ? await db.from("aawq_pengaturan").update(isi).eq("user_id", context.userId)
      : await db.from("aawq_pengaturan").insert({ user_id: context.userId, ...isi });
    if (error) throw new Error(/grade_/.test(error.message) ? "Jalankan migrasi 007_grade_aktif.sql dulu." : error.message);
    return { ok: true };
  });
