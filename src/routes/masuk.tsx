import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Tombol } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/masuk")({ component: Masuk });

function Masuk() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sandi, setSandi] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    setSibuk(true);
    setGalat(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: sandi });
    setSibuk(false);
    if (error) return setGalat(error.message === "Invalid login credentials" ? "Email atau sandi salah." : error.message);
    void navigate({ to: "/daftar" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={kirim} className="w-full max-w-sm rounded-lg border border-garis bg-panel p-6">
        <div className="mb-6 flex items-center gap-2 text-lg font-bold">
          <ShieldCheck className="size-6 text-aksen" aria-hidden /> AAwQData
        </div>
        <label className="block text-sm text-redup" htmlFor="email">
          Email
        </label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 mb-4 w-full rounded-md border border-garis bg-panel-2 px-3 py-2" />
        <label className="block text-sm text-redup" htmlFor="sandi">
          Sandi
        </label>
        <input id="sandi" type="password" autoComplete="current-password" required value={sandi} onChange={(e) => setSandi(e.target.value)} className="mt-1 mb-4 w-full rounded-md border border-garis bg-panel-2 px-3 py-2" />
        {galat ? <p className="mb-3 text-sm text-buang">{galat}</p> : null}
        <Tombol varian="utama" type="submit" disabled={sibuk} className="w-full">
          {sibuk ? "Masuk…" : "Masuk"}
        </Tombol>
        <p className="mt-4 text-xs text-redup">Akun dibuat oleh pemilik di Supabase (Authentication &gt; Users).</p>
      </form>
    </div>
  );
}
