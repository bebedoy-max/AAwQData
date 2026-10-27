/**
 * Skor aktif akun WhatsApp (0-100) dari sinyal yang dibaca gateway (/api/contacts/profile-batch).
 *
 * Skor = rata-rata berbobot dari sinyal yang TERBACA. Sinyal yang disembunyikan pemilik (privasi) tidak dihitung,
 * bukan dianggap buruk: menyembunyikan foto/About tidak berarti akun mati. Tidak ada satu sinyal pun yang memvonis
 * sendirian; tanggal lama hanya menurunkan rata-rata.
 *
 * Bobot dan ambang di sini adalah titik awal; setel ulang dengan laporan kalibrasi (prediksi vs delivered nyata).
 */
import type { KodeAlasan } from "./kualitas";

export interface SinyalWa {
  perangkat: number | null;
  tertaut: number | null;
  hosted: boolean | null;
  kunciTs: string | null;
  about: { status: "ada" | "kosong" | "tersembunyi"; teks: string | null; ts: string | null } | null;
  hilangTs: string | null;
  business: boolean | null;
  picture: "ada" | "tidak_ada" | "tersembunyi" | null;
}

export interface AturanAktif {
  ambang_ragu: number;
  ambang_buang: number;
  bisnis: "ragu" | "biarkan";
}

export const ATURAN_AKTIF_BAWAAN: AturanAktif = { ambang_ragu: 50, ambang_buang: 25, bisnis: "ragu" };

export interface PoinSinyal {
  kode: "perangkat_berubah" | "about" | "foto" | "tertaut" | "pesan_sementara";
  label: string;
  bobot: number;
  /** null = tidak terbaca/disembunyikan (tidak ikut rata-rata). */
  poin: number | null;
  keterangan: string;
}

export interface HasilAktivitas {
  skor: number | null;
  poin: PoinSinyal[];
  alasan: KodeAlasan[];
}

/** Teks About bawaan/pilihan cepat WhatsApp (berbagai bahasa): bukan tulisan sendiri pemiliknya. */
const ABOUT_BAWAAN =
  /^(hey there! i am using whatsapp\.?|available|disponível|disponivel|disponible|ada|tersedia|halo! saya menggunakan whatsapp\.?|olá! eu estou usando o whatsapp\.?|ola! eu estou usando o whatsapp\.?|hola, estoy usando whatsapp\.?|busy|sibuk|ocupado|at work|di kantor|no trabalho|en el trabajo|urgent calls only|hanya panggilan darurat|somente ligações urgentes|battery about to die|can'?t talk,? whatsapp only|in a meeting|sleeping|at school|at the gym|at the movies)$/i;

const hari = (iso: string | null, sekarang: Date) => (iso ? (sekarang.getTime() - Date.parse(iso)) / 86_400_000 : null);

function berdasarUmur(umur: number, tangga: Array<[number, number]>, sisanya: number): number {
  for (const [batas, poin] of tangga) if (umur <= batas) return poin;
  return sisanya;
}

const teksUmur = (umur: number) => (umur < 1 ? "hari ini" : umur < 60 ? `${Math.round(umur)} hari lalu` : umur < 730 ? `${Math.round(umur / 30)} bulan lalu` : `${(umur / 365).toLocaleString("id-ID", { maximumFractionDigits: 1 })} tahun lalu`);

export function nilaiAktivitas(s: SinyalWa, aturan: AturanAktif, sekarang = new Date()): HasilAktivitas {
  const poin: PoinSinyal[] = [];

  // 1. Daftar perangkat terakhir berubah (ganti HP, pasang ulang, tautkan Web). Tidak bisa disembunyikan.
  const umurKunci = hari(s.kunciTs, sekarang);
  poin.push({
    kode: "perangkat_berubah",
    label: "Perangkat terakhir berubah",
    bobot: 3,
    poin: umurKunci === null ? null : berdasarUmur(umurKunci, [[30, 100], [90, 90], [180, 80], [365, 65], [730, 50], [1095, 40]], 30),
    keterangan: umurKunci === null ? "tidak terbaca" : teksUmur(umurKunci),
  });

  // 2. About: ditulis/diubah baru-baru ini = aktif; teks bawaan lama = kemungkinan terbengkalai.
  let pAbout: number | null = null;
  let kAbout = "tidak terbaca";
  if (s.about?.status === "tersembunyi") kAbout = "disembunyikan";
  else if (s.about?.status === "kosong") kAbout = "kosong";
  else if (s.about?.status === "ada") {
    const umur = hari(s.about.ts, sekarang);
    const bawaan = ABOUT_BAWAAN.test((s.about.teks ?? "").trim());
    const dasar = umur === null ? 60 : berdasarUmur(umur, [[90, 100], [365, 80], [1095, 60]], 40);
    pAbout = bawaan ? Math.max(20, dasar - 30) : dasar;
    kAbout = `${bawaan ? "teks bawaan" : "ditulis sendiri"}${umur === null ? "" : `, diubah ${teksUmur(umur)}`}`;
  }
  poin.push({ kode: "about", label: "About", bobot: 2, poin: pAbout, keterangan: kAbout });

  // 3. Foto profil.
  poin.push({
    kode: "foto",
    label: "Foto profil",
    bobot: 2,
    poin: s.picture === "ada" ? 85 : s.picture === "tidak_ada" ? 30 : null,
    keterangan: s.picture === "ada" ? "ada" : s.picture === "tidak_ada" ? "tidak ada" : s.picture === "tersembunyi" ? "disembunyikan" : "tidak dicek",
  });

  // 4. Perangkat tertaut (WhatsApp Web/Desktop): hanya sinyal positif; tanpa tertaut tidak berarti tidak aktif.
  poin.push({
    kode: "tertaut",
    label: "Perangkat tertaut",
    bobot: 1,
    poin: s.tertaut && s.tertaut > 0 ? 100 : null,
    keterangan: s.tertaut === null ? "tidak terbaca" : s.tertaut > 0 ? `${s.tertaut} perangkat (Web/Desktop)` : "hanya HP",
  });

  // 5. Pesan sementara pernah diatur pemiliknya.
  const umurHilang = hari(s.hilangTs, sekarang);
  poin.push({
    kode: "pesan_sementara",
    label: "Pesan sementara",
    bobot: 1,
    poin: umurHilang === null ? null : umurHilang <= 365 ? 100 : 75,
    keterangan: umurHilang === null ? "tidak pernah diatur" : `diatur ${teksUmur(umurHilang)}`,
  });

  const terbaca = poin.filter((p) => p.poin !== null);
  const totalBobot = terbaca.reduce((n, p) => n + p.bobot, 0);
  const skor = totalBobot ? Math.round(terbaca.reduce((n, p) => n + p.bobot * (p.poin as number), 0) / totalBobot) : null;

  const alasan: KodeAlasan[] = [];
  if (skor !== null) {
    if (skor < aturan.ambang_buang) alasan.push("kemungkinan_tidak_aktif");
    else if (skor < aturan.ambang_ragu) alasan.push("aktivitas_rendah");
  }
  if (aturan.bisnis === "ragu" && (s.business === true || s.hosted === true)) alasan.push("akun_bisnis");
  return { skor, poin, alasan };
}
