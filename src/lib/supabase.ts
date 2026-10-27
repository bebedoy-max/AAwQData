import { createClient } from "@supabase/supabase-js";

/**
 * Klien Supabase di browser: hanya untuk login/sesi. Semua data dibaca dan ditulis lewat fungsi server
 * (lihat *.functions.ts) yang memeriksa pemilik daftar.
 */
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const kunci = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;

export const supabaseTerkonfigurasi = !!(url && kunci);

export const supabase = createClient(url || "http://supabase-belum-diatur.invalid", kunci || "belum-diatur", {
  auth: { persistSession: typeof window !== "undefined", autoRefreshToken: typeof window !== "undefined" },
});
