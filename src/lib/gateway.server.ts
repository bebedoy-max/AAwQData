/**
 * Klien gateway WhatsApp (AABaileys, API gaya WAHA) untuk perangkat pengecek.
 * Lingkungan: WA_GATEWAY_URL dan WA_GATEWAY_API_KEY. Pakai instance gateway TERPISAH dari WSPRO.
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

export const gatewayTerkonfigurasi = () => !!(process.env["WA_GATEWAY_URL"] && process.env["WA_GATEWAY_API_KEY"]);

async function minta<T>(jalur: string, init: RequestInit = {}, waktuMs = 60_000): Promise<T> {
  const url = process.env["WA_GATEWAY_URL"];
  const kunci = process.env["WA_GATEWAY_API_KEY"];
  if (!url || !kunci) throw new GalatGateway(500, "Gateway belum diatur: isi WA_GATEWAY_URL dan WA_GATEWAY_API_KEY di server.");
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

export const gateway = {
  buatSesi: (nama: string) => minta<SesiGateway>("/api/sessions", { method: "POST", body: JSON.stringify({ name: nama }) }),
  mulai: (nama: string) => minta<SesiGateway>(`/api/sessions/${enc(nama)}/start`, { method: "POST" }),
  sesi: (nama: string) => minta<SesiGateway>(`/api/sessions/${enc(nama)}`),
  hapus: (nama: string) => minta<unknown>(`/api/sessions/${enc(nama)}`, { method: "DELETE" }),
  qr: (nama: string) => minta<{ value: string }>(`/api/${enc(nama)}/auth/qr?format=raw`),
  kodePairing: (nama: string, nomor: string) => minta<{ code: string }>(`/api/${enc(nama)}/auth/request-code`, { method: "POST", body: JSON.stringify({ phoneNumber: nomor }) }),
  lepasBatasCek: (nama: string) => minta<SesiGateway>(`/api/sessions/${enc(nama)}/clear-check-limit`, { method: "POST" }),
  profil: (nama: string, nomor: string[], opsi: { foto: boolean; bisnis: boolean }) =>
    minta<{ results: HasilProfilGateway[] }>(
      "/api/contacts/profile-batch",
      { method: "POST", body: JSON.stringify({ session: nama, phones: nomor, picture: opsi.foto, business: opsi.bisnis }) },
      90_000,
    ),
  cek: (nama: string, nomor: string[]) =>
    minta<{ results: HasilCekGateway[] }>("/api/contacts/check-exists-batch", { method: "POST", body: JSON.stringify({ session: nama, phones: nomor }) }, 90_000),
};
