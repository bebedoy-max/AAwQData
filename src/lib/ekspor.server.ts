import crypto from "node:crypto";
import { ALASAN, type KodeAlasan } from "./kualitas";
import { supabaseAdmin } from "./supabase.server";

interface Tiket {
  daftarId: string;
  nama: string;
  /**
   * "terdaftar" = semua nomor yang terdaftar WhatsApp (wa = true), apa pun kategorinya.
   * "aktif" = nomor bernilai skor aktif yang tidak bertanda aktivitas rendah / kemungkinan tidak aktif
   * (sama dengan angka "aktif" di kartu Skor aktif, aawq_progres_wa.aktif_baik).
   */
  kategori: "siap" | "ragu" | "buang" | "semua" | "terdaftar" | "aktif" | "grade_a" | "grade_b" | "grade_c";
  format: "lengkap" | "nomor" | "laporan";
  /** Batas grade (ISO): aktivitas terakhir >= batasA = A, >= batasB = B, selebihnya C. */
  batasA?: string;
  batasB?: string;
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

const kolomEkspor = (t: Tiket): string =>
  `id, baris, mentah, e164, negara, tipe, kategori, skor, alasan, koreksi_dari, wa, aktif_skor, aktif_dinilai${t.batasA ? ", aktif_terakhir" : ""}`;

/** Grade satu baris untuk kolom unduhan lengkap ("" bila belum dinilai atau batas grade tidak dikirim). */
function gradeBaris(r: { aktif_dinilai?: boolean | null; aktif_skor?: number | null; aktif_terakhir?: string | null }, t: Tiket): string {
  if (!t.batasA || !t.batasB || !r.aktif_dinilai || r.aktif_skor === null || r.aktif_skor === undefined) return "";
  const w = r.aktif_terakhir ? Date.parse(r.aktif_terakhir) : NaN;
  if (Number.isFinite(w) && w >= Date.parse(t.batasA)) return "A";
  if (Number.isFinite(w) && w >= Date.parse(t.batasB)) return "B";
  return "C";
}

/** Alirkan CSV per 5.000 baris (keyset pada id) sampai habis: tanpa batas jumlah baris. */
export function aliranCsv(t: Tiket): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let terakhir = 0;
  let mulai = true;
  return new ReadableStream({
    async pull(ctrl) {
      if (mulai) {
        mulai = false;
        // Sebelum migrasi 007 kolom aktif_terakhir belum ada: unduhan biasa tetap jalan tanpa kolom grade.
        if (t.batasA && !t.kategori.startsWith("grade_")) {
          const { error: cekKolom } = await supabaseAdmin().from("aawq_nomor").select("aktif_terakhir").limit(1);
          if (cekKolom) {
            delete t.batasA;
            delete t.batasB;
          }
        }
        // BOM agar Excel membaca UTF-8 dengan benar.
        ctrl.enqueue(enc.encode(t.format === "nomor" ? "﻿nomor\n" : "﻿baris,mentah,nomor,negara,tipe,kategori,skor,alasan,koreksi_dari,whatsapp,skor_aktif,aktivitas_terakhir,grade\n"));
        return;
      }
      let q = supabaseAdmin()
        .from("aawq_nomor")
        // Kolom aktif_terakhir (migrasi 007) hanya diminta bila batas grade dikirim.
        .select(kolomEkspor(t) as "*")
        .eq("daftar_id", t.daftarId)
        .gt("id", terakhir)
        .order("id")
        .limit(5000);
      if (t.kategori === "terdaftar") q = q.eq("wa", true);
      else if (t.kategori === "grade_a" || t.kategori === "grade_b" || t.kategori === "grade_c") {
        q = q.eq("aktif_dinilai", true).not("aktif_skor", "is", null);
        if (t.kategori === "grade_a") q = q.gte("aktif_terakhir", t.batasA!);
        else if (t.kategori === "grade_b") q = q.lt("aktif_terakhir", t.batasA!).gte("aktif_terakhir", t.batasB!);
        else q = q.or(`aktif_terakhir.is.null,aktif_terakhir.lt.${t.batasB!}`);
      } else if (t.kategori === "aktif") {
        q = q.eq("aktif_dinilai", true).not("aktif_skor", "is", null).not("alasan", "ov", "{aktivitas_rendah,kemungkinan_tidak_aktif}");
      }
      else if (t.kategori !== "semua") q = q.eq("kategori", t.kategori);
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
            : [
                r.baris,
                r.mentah,
                r.e164,
                r.negara,
                r.tipe,
                r.kategori,
                r.skor,
                labelAlasan(r.alasan ?? []),
                r.koreksi_dari,
                r.wa === true ? "terdaftar" : r.wa === false ? "tidak terdaftar" : "",
                r.aktif_skor,
                r.aktif_terakhir ?? "",
                gradeBaris(r, t),
              ]
                .map(selCsv)
                .join(","),
        )
        .join("\n");
      ctrl.enqueue(enc.encode(teks + "\n"));
    },
  });
}

/**
 * Laporan Bio dalam bentuk teks: statistik, lalu semua nomor bisnis per level (dialirkan per 5.000).
 * Setiap pull wajib mengirim sesuatu atau menutup aliran: pull yang selesai tanpa enqueue tidak dipanggil lagi.
 */
export function aliranLaporan(t: Tiket): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let antrean: Array<[string, number]> | null = null;
  let level: string | null = null;
  let terakhir = 0;
  return new ReadableStream({
    async pull(ctrl) {
      const { kepalaLaporan, kepalaKelompok, barisBisnis, urutLevel } = await import("./laporan");
      const db = supabaseAdmin();
      if (antrean === null) {
        const { data, error } = await db.rpc("aawq_laporan_bio", { p_daftar: t.daftarId });
        if (error) {
          ctrl.enqueue(enc.encode(`LAPORAN GAGAL: ${error.message}\n`));
          ctrl.close();
          return;
        }
        const stat = data as import("./laporan").StatLaporan;
        antrean = urutLevel(Object.keys(stat.level)).map((l) => [l, stat.level[l] ?? 0]);
        ctrl.enqueue(enc.encode(`\uFEFF${kepalaLaporan(t.nama, stat, new Date())}`));
        return;
      }
      for (;;) {
        if (level === null) {
          const berikut = antrean.shift();
          if (!berikut) {
            ctrl.close();
            return;
          }
          [level] = berikut;
          terakhir = 0;
          ctrl.enqueue(enc.encode(`\n${kepalaKelompok(level, berikut[1])}`));
          return;
        }
        const { data, error } = await db.rpc("aawq_laporan_bisnis", { p_daftar: t.daftarId, p_level: level, p_setelah: terakhir, p_n: 5000 });
        if (error) {
          ctrl.enqueue(enc.encode(`\n# UNDUHAN GAGAL: ${error.message}\n`));
          ctrl.close();
          return;
        }
        const baris = (data ?? []) as import("./laporan").BarisBisnis[];
        if (!baris.length) {
          level = null;
          continue;
        }
        terakhir = baris[baris.length - 1]!.id;
        ctrl.enqueue(enc.encode(baris.map(barisBisnis).join("\n") + "\n"));
        return;
      }
    },
  });
}
