import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { wajibMasuk } from "./auth";
import type { BarisBisnis, StatLaporan } from "./laporan";

/** Statistik Laporan Bio satu daftar (dihitung dari hasil cek WhatsApp yang sudah tersimpan). */
export const laporanBio = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    const { data: stat, error } = await supabaseAdmin().rpc("aawq_laporan_bio", { p_daftar: data.daftarId });
    if (error) throw new Error(error.message);
    return { daftar: { id: daftar.id as string, nama: daftar.nama as string, status: daftar.status as string }, stat: stat as StatLaporan };
  });

/** Nomor bisnis satu level, per halaman (keyset pada id). */
export const nomorBisnis = createServerFn({ method: "GET" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid(), level: z.string().max(40), setelah: z.number().int().min(0).default(0) }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, pastikanPemilik } = await import("./supabase.server");
    await pastikanPemilik(data.daftarId, context.userId);
    const { data: baris, error } = await supabaseAdmin().rpc("aawq_laporan_bisnis", { p_daftar: data.daftarId, p_level: data.level, p_setelah: data.setelah, p_n: 200 });
    if (error) throw new Error(error.message);
    return (baris ?? []) as BarisBisnis[];
  });

/** Tiket unduhan laporan TXT lengkap (semua nomor bisnis, tanpa batas). */
export const buatTiketLaporan = createServerFn({ method: "POST" })
  .middleware([wajibMasuk])
  .inputValidator(z.object({ daftarId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { pastikanPemilik } = await import("./supabase.server");
    const { buatTiket } = await import("./ekspor.server");
    const daftar = await pastikanPemilik(data.daftarId, context.userId);
    return { url: `/api/ekspor/${buatTiket({ daftarId: daftar.id, nama: daftar.nama, kategori: "semua", format: "laporan", userId: context.userId })}` };
  });
