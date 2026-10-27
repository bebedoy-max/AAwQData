import crypto from "node:crypto";
import { ALASAN, type KodeAlasan } from "./kualitas";
import { supabaseAdmin } from "./supabase.server";

interface Tiket {
  daftarId: string;
  nama: string;
  kategori: "siap" | "ragu" | "buang" | "semua";
  format: "lengkap" | "nomor";
  userId: string;
  habis: number;
}

const tiket = new Map<string, Tiket>();

export function buatTiket(t: Omit<Tiket, "habis">): string {
  for (const [k, v] of tiket) if (v.habis < Date.now()) tiket.delete(k);
  const id = crypto.randomBytes(18).toString("base64url");
  tiket.set(id, { ...t, habis: Date.now() + 10 * 60_000 });
  return id;
}

/** Tiket hanya bisa dipakai sekali. */
export function ambilTiket(id: string): Tiket | null {
  const t = tiket.get(id);
  tiket.delete(id);
  return t && t.habis > Date.now() ? t : null;
}

export function selCsv(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const labelAlasan = (a: string[]) => a.map((x) => ALASAN[x as KodeAlasan]?.label ?? x).join("; ");

/** Alirkan CSV per 5.000 baris (keyset pada id) sampai habis: tanpa batas jumlah baris. */
export function aliranCsv(t: Tiket): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let terakhir = 0;
  let mulai = true;
  return new ReadableStream({
    async pull(ctrl) {
      if (mulai) {
        mulai = false;
        // BOM agar Excel membaca UTF-8 dengan benar.
        ctrl.enqueue(enc.encode(t.format === "nomor" ? "﻿nomor\n" : "﻿baris,mentah,nomor,negara,tipe,kategori,skor,alasan,koreksi_dari\n"));
        return;
      }
      let q = supabaseAdmin()
        .from("aawq_nomor")
        .select("id, baris, mentah, e164, negara, tipe, kategori, skor, alasan, koreksi_dari")
        .eq("daftar_id", t.daftarId)
        .gt("id", terakhir)
        .order("id")
        .limit(5000);
      if (t.kategori !== "semua") q = q.eq("kategori", t.kategori);
      if (t.format === "nomor") q = q.not("e164", "is", null);
      const { data, error } = await q;
      if (error) {
        ctrl.enqueue(enc.encode(`\n# UNDUHAN GAGAL: ${error.message}\n`));
        ctrl.close();
        return;
      }
      if (!data?.length) {
        ctrl.close();
        return;
      }
      terakhir = data[data.length - 1]!.id as number;
      const teks = data
        .map((r) =>
          t.format === "nomor"
            ? selCsv(r.e164)
            : [r.baris, r.mentah, r.e164, r.negara, r.tipe, r.kategori, r.skor, labelAlasan(r.alasan ?? []), r.koreksi_dari].map(selCsv).join(","),
        )
        .join("\n");
      ctrl.enqueue(enc.encode(teks + "\n"));
    },
  });
}
