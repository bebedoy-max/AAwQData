/**
 * Membaca berkas daftar nomor di browser: CSV/TXT (pemisah koma, titik koma, tab) atau Excel (.xlsx/.xls).
 * Hasilnya tabel baris x kolom berupa teks; kolom nomor dipilih otomatis (bisa diganti pengguna).
 */

export interface Tabel {
  kolom: string[];
  baris: string[][];
  /** true bila baris pertama berkas dipakai sebagai judul kolom. */
  adaJudul: boolean;
}

/** Pengurai CSV sederhana yang menghormati kutip ganda. Pemisah dideteksi dari baris pertama. */
export function uraiCsv(teks: string): string[][] {
  const bersih = teks.replace(/^﻿/, "");
  const barisPertama = bersih.slice(0, bersih.indexOf("\n") === -1 ? undefined : bersih.indexOf("\n"));
  const calon = [",", ";", "\t", "|"];
  const pemisah = calon.reduce((a, b) => (barisPertama.split(b).length > barisPertama.split(a).length ? b : a), ",");
  const hasil: string[][] = [];
  let baris: string[] = [];
  let sel = "";
  let kutip = false;
  for (let i = 0; i < bersih.length; i++) {
    const c = bersih[i]!;
    if (kutip) {
      if (c === '"') {
        if (bersih[i + 1] === '"') {
          sel += '"';
          i++;
        } else kutip = false;
      } else sel += c;
    } else if (c === '"' && sel === "") kutip = true;
    else if (c === pemisah) {
      baris.push(sel);
      sel = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && bersih[i + 1] === "\n") i++;
      baris.push(sel);
      hasil.push(baris);
      baris = [];
      sel = "";
    } else sel += c;
  }
  if (sel !== "" || baris.length) {
    baris.push(sel);
    hasil.push(baris);
  }
  return hasil.filter((b) => b.some((s) => s.trim() !== ""));
}

const miripNomor = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 16 && d.length >= s.replace(/[\s+\-().]/g, "").length * 0.9;
};

/** Baris pertama dianggap judul bila tidak satu pun selnya mirip nomor tetapi baris berikutnya ada. */
export function jadikanTabel(data: string[][]): Tabel {
  const lebar = Math.max(1, ...data.slice(0, 50).map((b) => b.length));
  const pertama = data[0] ?? [];
  const adaJudul = data.length > 1 && !pertama.some(miripNomor) && data.slice(1, 20).some((b) => b.some(miripNomor));
  const kolom = Array.from({ length: lebar }, (_, i) => (adaJudul && pertama[i]?.trim()) || `Kolom ${i + 1}`);
  return { kolom, baris: adaJudul ? data.slice(1) : data, adaJudul };
}

/** Kolom dengan proporsi sel mirip nomor terbanyak (dari 500 baris pertama). */
export function tebakKolomNomor(t: Tabel): number {
  const contoh = t.baris.slice(0, 500);
  let terbaik = 0;
  let skorTerbaik = -1;
  for (let k = 0; k < t.kolom.length; k++) {
    const judul = t.kolom[k]!.toLowerCase();
    const skor = contoh.filter((b) => miripNomor(b[k] ?? "")).length + (/(nomor|phone|telp|hp|wa|whatsapp|msisdn|mobile)/.test(judul) ? 5 : 0);
    if (skor > skorTerbaik) {
      skorTerbaik = skor;
      terbaik = k;
    }
  }
  return terbaik;
}

export async function bacaBerkas(berkas: File): Promise<Tabel> {
  const nama = berkas.name.toLowerCase();
  if (/\.(xlsx|xls|xlsm|ods)$/.test(nama)) {
    const XLSX = await import("xlsx-js-style");
    const wb = XLSX.read(await berkas.arrayBuffer(), { type: "array", dense: true });
    const lembar = wb.Sheets[wb.SheetNames[0]!]!;
    // Nilai mentah, bukan teks tampilan: sel angka berformat General tampil sebagai 5,51192E+12 dan digitnya hilang.
    // Nomor telepon (<= 15 digit) muat utuh di angka JS, jadi angka bulat diubah ke teks tanpa notasi ilmiah.
    const data = XLSX.utils
      .sheet_to_json<unknown[]>(lembar, { header: 1, raw: true, defval: "" })
      .map((b) => b.map((s) => (typeof s === "number" ? (Number.isInteger(s) ? BigInt(s).toString() : String(s)) : String(s ?? ""))));
    return jadikanTabel(data.filter((b) => b.some((s) => s.trim() !== "")));
  }
  return jadikanTabel(uraiCsv(await berkas.text()));
}

/** Tempelan teks: satu nomor per baris (atau dipisah koma/titik koma). */
export function dariTeks(teks: string): Tabel {
  const nomor = teks.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  return { kolom: ["Nomor"], baris: nomor.map((n) => [n]), adaJudul: false };
}
