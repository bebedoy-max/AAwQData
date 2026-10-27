/** Laporan Bio: bentuk data dan penyusun teks laporan (dipakai halaman dan unduhan TXT). */

export interface StatLaporan {
  total: number;
  nomor_valid: number;
  terdaftar: number;
  tidak_terdaftar: number;
  belum_pasti: number;
  dinilai: number;
  bio_sendiri: number;
  bio_bawaan: number;
  bio_kosong: number;
  bio_tersembunyi: number;
  bio_tidak_terbaca: number;
  bisnis: number;
  pribadi: number;
  foto_ada: number;
  level: Record<string, number>;
  tahun: Record<string, number>;
}

export interface BarisBisnis {
  id: number;
  e164: string;
  level: string;
  nama: string | null;
  sejak: string | null;
}

/** Urutan tampil level: tertinggi dulu, level tak dikenal di akhir. */
const URUT_LEVEL = ["high", "medium", "low", "unknown", "tidak diketahui"];
export const urutLevel = (lv: string[]) =>
  [...lv].sort((a, b) => (URUT_LEVEL.indexOf(a) + 1 || 99) - (URUT_LEVEL.indexOf(b) + 1 || 99) || a.localeCompare(b));

export const labelLevel = (lv: string) => (lv === "tidak diketahui" ? "Tak diketahui" : lv.charAt(0).toUpperCase() + lv.slice(1));
export const judulKelompok = (lv: string) => (lv === "tidak diketahui" ? "Meta Business, level tak diketahui" : `${labelLevel(lv)} Meta Business`);

const BULAN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const bulanTahun = (iso: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const p = (n: number, dari: number) => (dari ? `${((n / dari) * 100).toFixed(1)}%` : "0%");
const garis = "========================";

export function waktuWib(d: Date) {
  const w = new Date(d.getTime() + 7 * 3_600_000);
  const dua = (n: number) => String(n).padStart(2, "0");
  return `${dua(w.getUTCDate())}/${dua(w.getUTCMonth() + 1)}/${w.getUTCFullYear()} ${dua(w.getUTCHours())}:${dua(w.getUTCMinutes())}`;
}

/** Bagian kepala laporan TXT (statistik); daftar nomor per level ditambahkan oleh pemanggil. */
export function kepalaLaporan(nama: string, s: StatLaporan, waktu: Date): string {
  const dicek = s.terdaftar + s.tidak_terdaftar;
  const baris = [
    garis,
    `  LAPORAN BIO — ${waktuWib(waktu)} WIB`,
    garis,
    `  Daftar      : ${nama}`,
    `  Total input : ${s.total} nomor`,
    garis,
    "",
    "STATISTIK RINGKASAN",
    "-------------------",
    `  Terdaftar WA      : ${s.terdaftar}  (${p(s.terdaftar, dicek)})`,
    `  Tidak Terdaftar   : ${s.tidak_terdaftar}  (${p(s.tidak_terdaftar, dicek)})`,
  ];
  if (s.belum_pasti) baris.push(`  Belum/tidak pasti : ${s.belum_pasti}`);
  const tanpaBio = s.bio_bawaan + s.bio_kosong + s.bio_tersembunyi + s.bio_tidak_terbaca;
  baris.push(
    "",
    `  ── dari ${s.terdaftar} terdaftar (${s.dinilai} sudah dibaca profilnya) ──`,
    `  Memiliki Bio      : ${s.bio_sendiri}`,
    `  Tanpa Bio         : ${tanpaBio}`,
    `     ├ Teks bawaan  : ${s.bio_bawaan}`,
    `     ├ Kosong       : ${s.bio_kosong}`,
    `     ├ Disembunyikan: ${s.bio_tersembunyi}`,
    `     └ Tak terbaca  : ${s.bio_tidak_terbaca}`,
    `  Akun pribadi      : ${s.pribadi}`,
    `  Business Meta     : ${s.bisnis}`,
  );
  const lv = urutLevel(Object.keys(s.level));
  lv.forEach((l, i) => baris.push(`     ${i === lv.length - 1 ? "└" : "├"} ${labelLevel(l).padEnd(12)}: ${s.level[l]}`));
  const tahun = Object.keys(s.tahun).sort();
  if (tahun.length) {
    baris.push("", "Tahun sertifikat bisnis diterbitkan:");
    for (const t of tahun) baris.push(`  - ${t}: ${s.tahun[t]}`);
  }
  baris.push("", "");
  return baris.join("\n");
}

export const kepalaKelompok = (lv: string, n: number) => `${garis}\n[ ${judulKelompok(lv)} ] (${n})\n${garis}\n`;
export const barisBisnis = (b: BarisBisnis) => `+${b.e164} (${labelLevel(b.level)}) · ${bulanTahun(b.sejak)}${b.nama ? ` · ${b.nama}` : ""}`;
