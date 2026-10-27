import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Klien Supabase server (service role, melewati RLS). Hanya dipakai di fungsi server setelah pemilik data
 * diperiksa (pastikanPemilik). Variabel lingkungan: SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.
 */
let admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const kunci = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !kunci) throw new Error("Server belum diatur: isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY.");
  admin = createClient(url, kunci, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** Token login yang sah -> id pengguna (disimpan sebentar agar unggahan bertahap tidak memanggil auth tiap potongan). */
const cache = new Map<string, { userId: string; habis: number }>();

export async function penggunaDariToken(token: string | null | undefined): Promise<string> {
  if (!token) throw new Error("UNAUTHORIZED: silakan masuk lagi");
  const ada = cache.get(token);
  if (ada && ada.habis > Date.now()) return ada.userId;
  const { data, error } = await supabaseAdmin().auth.getUser(token);
  if (error || !data.user) throw new Error("UNAUTHORIZED: sesi tidak valid, silakan masuk lagi");
  if (cache.size > 2000) cache.clear();
  cache.set(token, { userId: data.user.id, habis: Date.now() + 60_000 });
  return data.user.id;
}

/** Pastikan daftar milik pengguna ini; kembalikan barisnya. */
export async function pastikanPemilik(daftarId: string, userId: string) {
  const { data, error } = await supabaseAdmin().from("aawq_daftar").select("*").eq("id", daftarId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.user_id !== userId) throw new Error("Daftar tidak ditemukan");
  return data as BarisDaftar;
}

export interface BarisDaftar {
  id: string;
  user_id: string;
  nama: string;
  negara_target: string[];
  koreksi_kode_negara: boolean;
  status: "mengunggah" | "menganalisis" | "selesai" | "gagal";
  jumlah_total: number;
  jumlah_siap: number;
  jumlah_ragu: number;
  jumlah_buang: number;
  galat: string | null;
  dibuat: string;
  selesai_pada: string | null;
  cek_wa_status: "belum" | "berjalan" | "jeda" | "selesai";
}
