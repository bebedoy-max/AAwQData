/**
 * Keputusan penjadwalan cek WhatsApp (murni, dites): kapan perangkat pengecek boleh dipakai, jeda antar kelompok,
 * dan perkiraan lama pengecekan. Pekerja latar (cek-wa.server.ts) hanya menjalankan keputusan ini.
 */

export interface AturanCek {
  ukuran_kelompok: number;
  jeda_min_detik: number;
  jeda_maks_detik: number;
  batas_harian: number;
  umur_cache_hari: number;
  /** Fase kedua: sinyal aktivitas untuk nomor yang terdaftar (lihat aktivitas.ts). */
  cek_aktivitas: boolean;
  cek_foto: boolean;
  cek_bisnis: boolean;
  ambang_ragu: number;
  ambang_buang: number;
  bisnis: "ragu" | "biarkan";
  /** Sumber reader (menu Pengaturan): gateway pengecek terpisah (nq) atau perangkat WSPRO (aabaileys). */
  sumber_gateway: "nq" | "aabaileys";
  /** Grade aktivitas (migrasi 007): A = aktivitas terakhir <= grade_a_hari, B = <= grade_b_hari, C = lebih lama. */
  grade_a_hari: number;
  grade_b_hari: number;
}

export const ATURAN_BAWAAN: AturanCek = {
  ukuran_kelompok: 20,
  jeda_min_detik: 8,
  jeda_maks_detik: 15,
  batas_harian: 15000,
  umur_cache_hari: 30,
  cek_aktivitas: true,
  cek_foto: true,
  cek_bisnis: true,
  ambang_ragu: 50,
  ambang_buang: 25,
  bisnis: "ragu",
  sumber_gateway: "nq",
  grade_a_hari: 3,
  grade_b_hari: 30,
};

/** Ukuran kelompok fase aktivitas: gateway menerima maks 20 nomor bila foto ikut dicek (foto diambil per nomor). */
export const ukuranKelompokAktif = (a: AturanCek) => Math.min(a.ukuran_kelompok, a.cek_foto ? 20 : 50);

export interface KeadaanPengecek {
  aktif: boolean;
  status: string;
  ditahan_sampai: string | null;
  hari: string;
  cek_hari_ini: number;
}

/** Tanggal kalender WIB (YYYY-MM-DD); batas harian direset tengah malam WIB. */
export const hariWib = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

export function cekHariIni(p: Pick<KeadaanPengecek, "hari" | "cek_hari_ini">, sekarang: Date): number {
  return p.hari === hariWib(sekarang) ? p.cek_hari_ini : 0;
}

export function kesiapan(p: KeadaanPengecek, aturan: AturanCek, sekarang: Date): { siap: boolean; alasan: string } {
  if (!p.aktif) return { siap: false, alasan: "Dinonaktifkan" };
  if (p.ditahan_sampai && Date.parse(p.ditahan_sampai) > sekarang.getTime()) return { siap: false, alasan: "Ditahan (dibatasi WhatsApp)" };
  if (p.status !== "WORKING") return { siap: false, alasan: p.status === "SCAN_QR_CODE" ? "Belum dipasangkan" : "Tidak tersambung" };
  if (aturan.batas_harian > 0 && cekHariIni(p, sekarang) >= aturan.batas_harian) return { siap: false, alasan: "Batas harian tercapai" };
  return { siap: true, alasan: "Siap" };
}

/** Jeda acak antar kelompok (detik -> ms). Minimal 3 dtk, sama dengan pengaman gateway. */
export function jedaBerikut(aturan: AturanCek, acak = Math.random): number {
  const min = Math.max(3, Math.min(aturan.jeda_min_detik, aturan.jeda_maks_detik));
  const maks = Math.max(min, aturan.jeda_maks_detik);
  return Math.round((min + (maks - min) * acak()) * 1000);
}

/** Perkiraan lama (detik) untuk `sisa` nomor dengan `perangkat` pengecek siap, termasuk batas harian. */
export function perkiraanDetik(sisa: number, perangkat: number, aturan: AturanCek): number | null {
  if (sisa <= 0) return 0;
  if (perangkat <= 0) return null;
  const rataJeda = Math.max(3, (aturan.jeda_min_detik + Math.max(aturan.jeda_min_detik, aturan.jeda_maks_detik)) / 2);
  const perDetik = (perangkat * aturan.ukuran_kelompok) / rataJeda;
  const kerja = sisa / perDetik;
  if (aturan.batas_harian <= 0) return Math.ceil(kerja);
  // Setiap hari paling banyak batas_harian x perangkat nomor; sisanya menunggu hari berikutnya.
  const perHari = aturan.batas_harian * perangkat;
  const hariPenuh = Math.floor((sisa - 1) / perHari);
  return Math.ceil(hariPenuh * 86_400 + ((sisa - hariPenuh * perHari) / perDetik));
}

export function teksDurasi(detik: number | null): string {
  if (detik === null) return "menunggu perangkat siap";
  if (detik < 90) return `${Math.max(1, Math.round(detik))} detik`;
  if (detik < 5400) return `${Math.round(detik / 60)} menit`;
  if (detik < 172_800) return `${(detik / 3600).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam`;
  return `${(detik / 86_400).toLocaleString("id-ID", { maximumFractionDigits: 1 })} hari`;
}
