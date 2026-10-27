import { Link, useNavigate } from "@tanstack/react-router";
import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase, supabaseTerkonfigurasi } from "@/lib/supabase";

/** Kerangka halaman yang butuh login: header + penjaga sesi (tanpa sesi -> /masuk). */
export function Kerangka({ judul, aksi, children }: { judul?: ReactNode; aksi?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  const [siap, setSiap] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseTerkonfigurasi) return setSiap(true);
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) void navigate({ to: "/masuk" });
      else {
        setEmail(data.session.user.email ?? null);
        setSiap(true);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_e, sesi) => {
      if (!sesi) void navigate({ to: "/masuk" });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-garis bg-latar/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/daftar" className="flex items-center gap-2 font-bold tracking-wide">
            <ShieldCheck className="size-5 text-aksen" aria-hidden />
            AAwQData
          </Link>
          <span className="hidden text-xs text-redup sm:inline">Kualitas nomor target</span>
          <span className="flex-1" />
          {email ? <span className="hidden text-xs text-redup md:inline">{email}</span> : null}
          <button
            type="button"
            aria-label="Keluar"
            className="rounded-md p-2 text-redup hover:text-teks"
            onClick={() => void supabase.auth.signOut().then(() => navigate({ to: "/masuk" }))}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {!supabaseTerkonfigurasi ? (
          <div className="mb-4 rounded-md border border-ragu/40 bg-ragu/10 p-3 text-sm text-ragu">
            Supabase belum diatur: isi VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY saat build.
          </div>
        ) : null}
        {judul || aksi ? (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <h1 className="flex-1 text-xl font-semibold">{judul}</h1>
            {aksi}
          </div>
        ) : null}
        {siap ? children : <p className="text-sm text-redup">Memuat…</p>}
      </main>
    </div>
  );
}
