/**
 * Klien gateway WhatsApp (AABaileys, API gaya WAHA) untuk perangkat pengecek (reader).
 *
 * Dua sumber reader (dipilih di menu Pengaturan):
 * - 'nq'        : gateway pengecek terpisah, WA_GATEWAY_URL + WA_GATEWAY_API_KEY (perangkat dipasangkan di AAwQData).
 * - 'aabaileys' : gateway AABaileys milik WSPRO, WSPRO_GATEWAYS = "url|kunci,url|kunci" (perangkat yang tersambung
 *                 di WSPRO dipakai sebagai reader; sesinya tidak pernah dibuat/dihapus dari sini).
 */

export class GalatGateway extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SesiGateway {
  name: string;
  status: string;
  me: { id: string; pushName: string | null } | null;
  restriction?: { reason: string; until: string };
  checkLimit?: { reason: string; until: string };
}

export interface HasilCekGateway {
  phone: string;
  numberExists: boolean | null;
  status: "terdaftar" | "tidak_terdaftar" | "tidak_pasti";
}

export interface HasilProfilGateway {
  phone: string;
  status: "ok" | "tidak_pasti";
  perangkat?: number | null;
  tertaut?: number | null;
  hosted?: boolean | null;
  kunciTs?: string | null;
  about?: { status: "ada" | "kosong" | "tersembunyi"; teks: string | null; ts: string | null } | null;
  hilangTs?: string | null;
  business?: boolean | null;
  /** Sertifikat nama bisnis: level dari WhatsApp + waktu terbit; false = akun pribadi; null = tidak terbaca. */
  bisnisVn?: SertifikatBisnis | false | null;
  picture?: "ada" | "tidak_ada" | "tersembunyi" | null;
}

export interface SertifikatBisnis {
  level: string | null;
  nama: string | null;
  sejak: string | null;
}

export type SumberReader = "nq" | "aabaileys";

export interface TujuanGateway {
  url: string;
  kunci: string;
}

const tanpaGaris = (u: string) => u.trim().replace(/\/+$/, "");

/** Gateway pengecek terpisah (nq-gate). */
export function gatewayNq(): TujuanGateway | null {
  const url = process.env["WA_GATEWAY_URL"];
  const kunci = process.env["WA_GATEWAY_API_KEY"];
  return url && kunci ? { url: tanpaGaris(url), kunci } : null;
}

/** Gateway AABaileys milik WSPRO: WSPRO_GATEWAYS="https://wg1.contoh|kunci1,https://wg2.contoh|kunci2". */
export function gatewayWspro(): TujuanGateway[] {
  return String(process.env["WSPRO_GATEWAYS"] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.lastIndexOf("|");
      return i > 0 ? { url: tanpaGaris(x.slice(0, i)), kunci: x.slice(i + 1).trim() } : null;
    })
    .filter((x): x is TujuanGateway => !!x && !!x.url && !!x.kunci);
}

/** Ada setidaknya satu sumber reader yang bisa dipakai (pekerja latar boleh berjalan). */
export const gatewayTerkonfigurasi = () => !!gatewayNq() || gatewayWspro().length > 0;

export const sumberTerkonfigurasi = (sumber: SumberReader) => (sumber === "nq" ? !!gatewayNq() : gatewayWspro().length > 0);

/** Tujuan gateway untuk satu perangkat pengecek: nq-gate, atau gateway WSPRO yang dicatat di barisnya. */
export function tujuanPerangkat(p: { sumber?: string | null; gateway?: string | null }): TujuanGateway {
  if (p.sumber === "aabaileys") {
    const t = gatewayWspro().find((g) => g.url === tanpaGaris(String(p.gateway ?? "")));
    if (!t) throw new GalatGateway(500, "Gateway WSPRO perangkat ini tidak ada di WSPRO_GATEWAYS.");
    return t;
  }
  const t = gatewayNq();
  if (!t) throw new GalatGateway(500, "Gateway belum diatur: isi WA_GATEWAY_URL dan WA_GATEWAY_API_KEY di server.");
  return t;
}

async function minta<T>(tujuan: TujuanGateway | null, jalur: string, init: RequestInit = {}, waktuMs = 60_000): Promise<T> {
  if (!tujuan) throw new GalatGateway(500, "Gateway belum diatur: isi WA_GATEWAY_URL dan WA_GATEWAY_API_KEY di server.");
  const { url, kunci } = tujuan;
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}${jalur}`, {
      ...init,
      headers: { "x-api-key": kunci, "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(waktuMs),
    });
  } catch (e) {
    throw new GalatGateway(503, `Gateway tidak terjangkau: ${(e as Error).message}`);
  }
  const teks = await res.text();
  let isi: any = null;
  try {
    isi = teks ? JSON.parse(teks) : null;
  } catch {
    isi = teks;
  }
  if (!res.ok) throw new GalatGateway(res.status, (isi && typeof isi === "object" ? isi.message : String(isi).slice(0, 200)) || `HTTP ${res.status}`);
  return isi as T;
}

const enc = encodeURIComponent;

/** Operasi baca/cek yang dipakai kedua sumber reader. */
export function klien(tujuan: TujuanGateway | null) {
  return {
    sesi: (nama: string) => minta<SesiGateway>(tujuan, `/api/sessions/${enc(nama)}`),
    semuaSesi: () => minta<SesiGateway[]>(tujuan, "/api/sessions"),
    lepasBatasCek: (nama: string) => minta<SesiGateway>(tujuan, `/api/sessions/${enc(nama)}/clear-check-limit`, { method: "POST" }),
    profil: (nama: string, nomor: string[], opsi: { foto: boolean; bisnis: boolean }) =>
      minta<{ results: HasilProfilGateway[] }>(
        tujuan,
        "/api/contacts/profile-batch",
        { method: "POST", body: JSON.stringify({ session: nama, phones: nomor, picture: opsi.foto, business: opsi.bisnis }) },
        90_000,
      ),
    cek: (nama: string, nomor: string[]) =>
      minta<{ results: HasilCekGateway[] }>(tujuan, "/api/contacts/check-exists-batch", { method: "POST", body: JSON.stringify({ session: nama, phones: nomor }) }, 90_000),
  };
}

/** Klien untuk satu perangkat pengecek (memilih gateway sesuai sumbernya). */
export const klienPerangkat = (p: { sumber?: string | null; gateway?: string | null }) => klien(tujuanPerangkat(p));

/**
 * Gateway pengecek terpisah (nq-gate): termasuk membuat, memasangkan, dan menghapus sesi. Operasi itu sengaja
 * TIDAK tersedia untuk gateway WSPRO, supaya AAwQData tidak pernah mengubah perangkat milik worker WSPRO.
 */
export const gateway = {
  ...klien(gatewayNq()),
  buatSesi: (nama: string) => minta<SesiGateway>(gatewayNq(), "/api/sessions", { method: "POST", body: JSON.stringify({ name: nama }) }),
  mulai: (nama: string) => minta<SesiGateway>(gatewayNq(), `/api/sessions/${enc(nama)}/start`, { method: "POST" }),
  hapus: (nama: string) => minta<unknown>(gatewayNq(), `/api/sessions/${enc(nama)}`, { method: "DELETE" }),
  qr: (nama: string) => minta<{ value: string }>(gatewayNq(), `/api/${enc(nama)}/auth/qr?format=raw`),
  kodePairing: (nama: string, nomor: string) =>
    minta<{ code: string }>(gatewayNq(), `/api/${enc(nama)}/auth/request-code`, { method: "POST", body: JSON.stringify({ phoneNumber: nomor }) }),
};
