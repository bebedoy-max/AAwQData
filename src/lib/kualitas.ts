/**
 * Mesin kualitas nomor target (murni, tanpa database): dipakai server saat nomor diunggah.
 *
 * Satu nomor -> format internasional (E.164 tanpa "+", sama dengan WSPro), negara, tipe, daftar alasan, lalu
 * skor 0-100 dan kategori:
 *   siap  = layak dikirim;
 *   ragu  = bisa dikirim tetapi berisiko (mis. kode negara dikoreksi otomatis, pola mencurigakan);
 *   buang = hampir pasti gagal/terbuang (tidak valid, negara lain, telepon rumah, duplikat).
 *
 * Pemeriksaan tingkat daftar (duplikat, deret nomor berurutan) dijalankan di database setelah semua nomor masuk
 * (fungsi aawq_analisis_daftar); bobotnya mengikuti ALASAN di bawah.
 */
import parsePhoneNumber, { getCountryCallingCode, isSupportedCountry, type CountryCode, type PhoneNumber } from "libphonenumber-js/max";

export type Kategori = "siap" | "ragu" | "buang";

export type KodeAlasan =
  | "kosong"
  | "bukan_nomor"
  | "tidak_valid"
  | "negara_lain"
  | "kode_negara_dikoreksi"
  | "telepon_rumah"
  | "nomor_khusus"
  | "tipe_tidak_dikenal"
  | "pola_berulang"
  | "pola_urut"
  | "duplikat"
  | "deret_berurutan";

export interface InfoAlasan {
  label: string;
  /** Pengurang skor. */
  bobot: number;
  /** Kategori paling ringan yang masih mungkin bila alasan ini ada. */
  kategori: Exclude<Kategori, "siap">;
  penjelasan: string;
}

export const ALASAN: Record<KodeAlasan, InfoAlasan> = {
  kosong: { label: "Kosong", bobot: 100, kategori: "buang", penjelasan: "Sel tidak berisi nomor." },
  bukan_nomor: { label: "Bukan nomor", bobot: 100, kategori: "buang", penjelasan: "Isinya bukan nomor telepon (huruf/teks)." },
  tidak_valid: { label: "Tidak valid", bobot: 100, kategori: "buang", penjelasan: "Panjang atau awalan tidak sesuai aturan penomoran negara mana pun." },
  negara_lain: { label: "Negara lain", bobot: 80, kategori: "buang", penjelasan: "Nomor valid tetapi bukan dari negara target kampanye." },
  kode_negara_dikoreksi: {
    label: "Kode negara dikoreksi",
    bobot: 25,
    kategori: "ragu",
    penjelasan: "Nomor tampak salah kode negara saat impor (mis. nomor lokal Hong Kong diberi awalan 62); dikoreksi otomatis ke negara target.",
  },
  telepon_rumah: { label: "Telepon rumah", bobot: 70, kategori: "buang", penjelasan: "Nomor telepon tetap (bukan seluler); hampir tidak pernah memakai WhatsApp." },
  nomor_khusus: { label: "Nomor khusus", bobot: 80, kategori: "buang", penjelasan: "Bebas pulsa, premium, pager, VoIP, atau nomor layanan; bukan nomor pribadi." },
  tipe_tidak_dikenal: { label: "Tipe tidak dikenal", bobot: 20, kategori: "ragu", penjelasan: "Valid, tetapi tidak bisa dipastikan nomor seluler." },
  pola_berulang: { label: "Pola berulang", bobot: 40, kategori: "ragu", penjelasan: "Banyak digit sama berturut-turut (mis. ...000000); sering nomor palsu/isian." },
  pola_urut: { label: "Pola urut", bobot: 40, kategori: "ragu", penjelasan: "Digit akhir berurutan (mis. ...1234567); sering nomor palsu/isian." },
  duplikat: { label: "Duplikat", bobot: 100, kategori: "buang", penjelasan: "Nomor yang sama sudah ada lebih awal di daftar ini." },
  deret_berurutan: {
    label: "Deret berurutan",
    bobot: 30,
    kategori: "ragu",
    penjelasan: "Bagian dari deret nomor yang berselisih 1 (…001, …002, …003); ciri daftar hasil generator, bukan pengguna nyata.",
  },
};

export interface OpsiCek {
  /** Negara tujuan kampanye. Kosong = semua negara diterima. */
  negaraTarget: CountryCode[];
  /** Negara untuk nomor tanpa kode negara (awalan 0 atau nomor lokal). Bawaan: negara target pertama, lalu ID. */
  negaraBawaan?: CountryCode;
  /** Coba perbaiki nomor yang salah kode negara menjadi nomor negara target. Bawaan: ya. */
  koreksiKodeNegara?: boolean;
}

export interface HasilCek {
  mentah: string;
  /** Format internasional tanpa "+" (siap dikirim ke WhatsApp), null bila tidak bisa dibaca. */
  e164: string | null;
  negara: string | null;
  tipe: string | null;
  alasan: KodeAlasan[];
  /** Nomor asli (digit) bila kode negaranya dikoreksi. */
  koreksiDari: string | null;
  skor: number;
  kategori: Kategori;
}

const TIPE_SELULER = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);
const TIPE_KHUSUS = new Set(["TOLL_FREE", "PREMIUM_RATE", "SHARED_COST", "VOIP", "PERSONAL_NUMBER", "PAGER", "UAN", "VOICEMAIL"]);

function urai(teks: string, negara?: CountryCode): PhoneNumber | undefined {
  try {
    return negara ? parsePhoneNumber(teks, negara) : parsePhoneNumber(teks);
  } catch {
    return undefined;
  }
}

/** Skor dan kategori dari daftar alasan (dipakai juga setelah pemeriksaan tingkat daftar menambah alasan). */
export function nilai(alasan: KodeAlasan[]): { skor: number; kategori: Kategori } {
  const unik = [...new Set(alasan)];
  const skor = Math.max(0, 100 - unik.reduce((n, a) => n + ALASAN[a].bobot, 0));
  const kategori: Kategori = unik.some((a) => ALASAN[a].kategori === "buang") ? "buang" : unik.length ? "ragu" : "siap";
  return { skor, kategori };
}

/** Banyak digit sama berturut-turut, atau hampir seluruh nomor nasional satu digit. */
export function polaBerulang(nasional: string): boolean {
  if (/(\d)\1{5,}/.test(nasional)) return true;
  const hitung = new Map<string, number>();
  for (const d of nasional) hitung.set(d, (hitung.get(d) ?? 0) + 1);
  return nasional.length >= 8 && Math.max(...hitung.values()) / nasional.length >= 0.75;
}

/** Tujuh digit terakhir naik/turun satu per satu (1234567, 7654321, 3456789, ...). */
export function polaUrut(nasional: string): boolean {
  const ekor = nasional.slice(-7);
  if (ekor.length < 7) return false;
  let naik = true;
  let turun = true;
  for (let i = 1; i < ekor.length; i++) {
    const d = Number(ekor[i]) - Number(ekor[i - 1]);
    if (d !== 1) naik = false;
    if (d !== -1) turun = false;
  }
  return naik || turun;
}

/**
 * Nomor yang tidak cocok dengan negara target: apakah sebenarnya nomor nasional negara target yang salah diberi
 * kode negara? Dicoba: digit apa adanya sebagai nomor nasional, lalu digit setelah kode negara yang terbaca
 * (kode negara hasil urai, atau kode negara bawaan yang sering salah dipakai saat impor).
 */
function cobaKoreksi(digit: string, target: CountryCode[], kodeTerbaca: string[]): PhoneNumber | undefined {
  const calon = new Set<string>([digit]);
  for (const kode of kodeTerbaca) if (kode && digit.startsWith(kode) && digit.length - kode.length >= 6) calon.add(digit.slice(kode.length));
  for (const negara of target) {
    for (const c of calon) {
      const p = urai(c, negara);
      if (p?.isValid() && p.country === negara && TIPE_SELULER.has(p.getType() ?? "")) return p;
    }
  }
  return undefined;
}

export function cekNomor(masukan: unknown, opsi: OpsiCek): HasilCek {
  const mentah = String(masukan ?? "").trim();
  const target = opsi.negaraTarget.filter((n) => isSupportedCountry(n));
  const bawaan: CountryCode = opsi.negaraBawaan && isSupportedCountry(opsi.negaraBawaan) ? opsi.negaraBawaan : target[0] ?? "ID";
  const selesai = (h: Omit<HasilCek, "skor" | "kategori">): HasilCek => ({ ...h, ...nilai(h.alasan) });
  const kosong = { mentah, e164: null, negara: null, tipe: null, koreksiDari: null };

  if (!mentah) return selesai({ ...kosong, alasan: ["kosong"] });
  const digit = mentah.replace(/\D/g, "");
  // Huruf selain penanda ekstensi/pemisah: teks, email, nama, dsb.
  if (/[a-z]/i.test(mentah.replace(/\b(ext|x|tel|wa|hp)\b/gi, "")) || digit.length < 6) return selesai({ ...kosong, alasan: ["bukan_nomor"] });

  // Kandidat seperti formatPhoneAuto WSPro: +kode, 00kode, nomor lokal berawalan 0, atau kode negara tanpa +.
  const kandidat: Array<PhoneNumber | undefined> = [];
  if (mentah.startsWith("+")) kandidat.push(urai(mentah));
  else if (digit.startsWith("00")) kandidat.push(urai(`+${digit.slice(2)}`));
  else if (digit.startsWith("0")) kandidat.push(urai(digit, bawaan));
  else kandidat.push(urai(`+${digit}`), urai(digit, bawaan));
  const sah = kandidat.filter((p): p is PhoneNumber => !!p && p.isValid());
  const diTarget = (p: PhoneNumber) => !target.length || (!!p.country && target.includes(p.country));
  let terpilih = sah.find(diTarget) ?? sah[0];
  const alasan: KodeAlasan[] = [];
  let koreksiDari: string | null = null;

  if ((!terpilih || !diTarget(terpilih)) && target.length && opsi.koreksiKodeNegara !== false) {
    // 62 selalu dicoba: WSPro dan banyak alat impor memakai Indonesia sebagai negara bawaan.
    const kodeTerbaca = [...new Set([...kandidat.map((p) => (p ? String(p.countryCallingCode) : "")), getCountryCallingCode(bawaan), "62"])];
    const koreksi = cobaKoreksi(digit.replace(/^00/, ""), target, kodeTerbaca);
    if (koreksi) {
      koreksiDari = digit;
      terpilih = koreksi;
      alasan.push("kode_negara_dikoreksi");
    }
  }

  if (!terpilih) return selesai({ ...kosong, alasan: ["tidak_valid"] });
  const e164 = terpilih.number.replace("+", "");
  const tipe = terpilih.getType() ?? null;
  if (!diTarget(terpilih)) alasan.push("negara_lain");
  if (tipe === "FIXED_LINE") alasan.push("telepon_rumah");
  else if (tipe && TIPE_KHUSUS.has(tipe)) alasan.push("nomor_khusus");
  else if (!tipe || !TIPE_SELULER.has(tipe)) alasan.push("tipe_tidak_dikenal");
  const nasional = String(terpilih.nationalNumber);
  if (polaBerulang(nasional)) alasan.push("pola_berulang");
  else if (polaUrut(nasional)) alasan.push("pola_urut");
  return selesai({ mentah, e164, negara: terpilih.country ?? null, tipe, alasan, koreksiDari });
}
