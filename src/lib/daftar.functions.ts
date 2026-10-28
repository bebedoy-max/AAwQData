import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { wajibMasuk } from "./auth";

/** Nomor per panggilan unggahPotongan: cukup besar agar cepat, cukup kecil agar tidak melewati batas body. */
export const UKURAN_POTONGAN = 10_000;
const KATEGORI = ["siap", "ragu", "buang"] as const;

export const daftarSaya = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { data, error } = await supabaseAdmin()
      .from("aawq_daftar")
      .select("id, nama, negara_target, status, jumlah_total, jumlah_siap, jumlah_ragu, jumlah_buang, galat, dibuat, selesai_pada")
      .eq("user_id", context.userId)
      .order("dibuat", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const buatDaftar = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(
    z.object({
      nama: z.string().trim().min(1, "Nama daftar wajib diisi").max(120),
      negaraTarget: z.array(z.string().regex(/^[A-Z]{2}$/)).max(30),
      koreksiKodeNegara: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("./supabase.server");
    const { data: baris, error } = await supabaseAdmin()
      .from("aawq_daftar")
      .insert({ user_id: context.userId, nama: data.nama, negara_target: data.negaraTarget, koreksi_kode_negara: data.koreksiKodeNegara })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: baris.id as string };
  });

/**
 * Satu potongan unggahan: setiap nomor diperiksa mesin kualitas lalu disimpan. Nomor dikirim sebagai SATU teks
 * (satu nomor per baris): ribuan objek kecil membuat serialisasi RPC sangat lambat (puluhan detik per potongan).
 * baris = mulai + indeks, nomor baris asli di berkas (untuk menentukan kemunculan pertama saat cek duplikat).
 * Aman diulang: baris yang sudah tersimpan diabaikan (unik per daftar + baris), jadi ulang-coba tidak menggandakan.
 */
export const unggahPotongan = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(
    z.object({
      daftarId: z.string().uuid(),
      mulai: z.number().int().min(1),
      teks: z.string().max(UKURAN_POTONGAN * 201),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    const { cekNomor } = await import("./kualitas");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    if (daftar.status !== "mengunggah") throw new Error("Daftar ini sudah selesai diunggah");
    const nomor = data.teks.split("\n");
    if (nomor.length > UKURAN_POTONGAN) throw new Error(`maksimal ${UKURAN_POTONGAN} nomor per potongan`);
    const opsi = { negaraTarget: daftar.negara_target as never[], koreksiKodeNegara: daftar.koreksi_kode_negara };
    const baris = nomor.map((mentah, i) => {
      const h = cekNomor(mentah, opsi);
      return {
        daftar_id: daftar.id,
        baris: data.mulai + i,
        mentah: h.mentah.slice(0, 200),
        e164: h.e164,
        negara: h.negara,
        tipe: h.tipe,
        alasan: h.alasan,
        koreksi_dari: h.koreksiDari,
        skor: h.skor,
        kategori: h.kategori,
      };
    });
    // Lewat RPC (lihat aawq_simpan_nomor): insert massal supabase-js melambat kuadratik pada ribuan baris.
    for (let i = 0; i < baris.length; i += 5000) {
      const { error } = await supabaseAdmin().rpc("aawq_simpan_nomor", { p_baris: baris.slice(i, i + 5000) });
      if (error) throw new Error(error.message);
    }
    const hitung = { siap: 0, ragu: 0, buang: 0 };
    for (const b of baris) hitung[b.kategori]++;
    return { diterima: baris.length, ...hitung };
  });

/** Semua potongan sudah masuk: jalankan analisis tingkat daftar (duplikat, deret) dan hitung ringkasan. */
export const selesaikanUnggah = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    await pastikanPemilik(data.daftarId, context.userId);
    const { error } = await supabaseAdmin().rpc("aawq_analisis_daftar", { p_daftar: data.daftarId });
    if (error) {
      await supabaseAdmin().from("aawq_daftar").update({ status: "gagal", galat: error.message }).eq("id", data.daftarId);
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const detailDaftar = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    const { data: ringkasan, error } = await supabaseAdmin().rpc("aawq_ringkasan", { p_daftar: data.daftarId });
    if (error) throw new Error(error.message);
    return { daftar, ringkasan: ringkasan as Ringkasan };
  });

export interface Ringkasan {
  kategori: Partial<Record<(typeof KATEGORI)[number], number>>;
  alasan: Record<string, number>;
  negara: Array<{ negara: string; jumlah: number }>;
  dikoreksi: number;
}

/** Contoh baris untuk ditinjau (per halaman, bisa disaring kategori dan alasan). */
export const contohNomor = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .inputValidator(
    z.object({
      daftarId: z.string().uuid(),
      kategori: z.enum(KATEGORI).optional(),
      alasan: z.string().max(40).optional(),
      halaman: z.number().int().min(0).max(100_000).default(0),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    await pastikanPemilik(data.daftarId, context.userId);
    let q = supabaseAdmin()
      .from("aawq_nomor")
      .select("baris, mentah, e164, negara, tipe, alasan, koreksi_dari, skor, kategori, wa, aktif_skor, aktif_sinyal")
      .eq("daftar_id", data.daftarId)
      .order("baris")
      .range(data.halaman * 50, data.halaman * 50 + 49);
    if (data.kategori) q = q.eq("kategori", data.kategori);
    if (data.alasan) q = q.contains("alasan", [data.alasan]);
    const { data: baris, error } = await q;
    if (error) throw new Error(error.message);
    return baris ?? [];
  });

export const hapusDaftar = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    await pastikanPemilik(data.daftarId, context.userId);
    const { error } = await supabaseAdmin().from("aawq_daftar").delete().eq("id", data.daftarId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Tiket unduhan: fungsi server (yang membawa token login) membuat tiket sekali pakai, lalu browser membuka
 * /api/ekspor/<tiket> sebagai unduhan biasa. Berkas dialirkan dari database tanpa batas baris.
 */
export const buatTiketEkspor = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid(), kategori: z.enum([...KATEGORI, "semua", "terdaftar"]), format: z.enum(["lengkap", "nomor"]).default("lengkap") }))
  .handler(async ({ data, context }) => {
    const { pastikanPemilik } = await import("./supabase.server");
    const { buatTiket } = await import("./ekspor.server");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    return { url: `/api/ekspor/${buatTiket({ daftarId: daftar.id, nama: daftar.nama, kategori: data.kategori, format: data.format, userId: context.userId })}` };
  });
