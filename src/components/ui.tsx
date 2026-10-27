import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Varian = "utama" | "biasa" | "bahaya" | "tipis";

const VARIAN: Record<Varian, string> = {
  utama: "bg-aksen text-aksen-teks hover:brightness-110 font-semibold",
  biasa: "border border-garis bg-panel-2 text-teks hover:border-aksen/60",
  bahaya: "border border-buang/50 text-buang hover:bg-buang/10",
  tipis: "text-redup hover:text-teks",
};

export function Tombol({ varian = "biasa", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { varian?: Varian }) {
  return (
    <button
      type="button"
      {...p}
      className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm transition disabled:cursor-not-allowed disabled:opacity-50", VARIAN[varian], className)}
    />
  );
}

export function Kartu({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-lg border border-garis bg-panel p-4", className)}>{children}</section>;
}

export const WARNA_KATEGORI = { siap: "bg-siap", ragu: "bg-ragu", buang: "bg-buang" } as const;
export const TEKS_KATEGORI = { siap: "text-siap", ragu: "text-ragu", buang: "text-buang" } as const;
export const LABEL_KATEGORI = { siap: "Siap kirim", ragu: "Ragu", buang: "Buang" } as const;

/** Batang proporsi siap/ragu/buang. */
export function BatangKategori({ siap, ragu, buang, className }: { siap: number; ragu: number; buang: number; className?: string }) {
  const total = siap + ragu + buang;
  if (!total) return <div className={cn("h-2 rounded bg-panel-2", className)} />;
  return (
    <div className={cn("flex h-2 overflow-hidden rounded bg-panel-2", className)} role="img" aria-label={`Siap ${siap}, ragu ${ragu}, buang ${buang}`}>
      {(["siap", "ragu", "buang"] as const).map((k) => {
        const n = { siap, ragu, buang }[k];
        return n ? <div key={k} className={WARNA_KATEGORI[k]} style={{ width: `${(n / total) * 100}%` }} /> : null;
      })}
    </div>
  );
}

export const angka = (n: number | null | undefined) => (n ?? 0).toLocaleString("id-ID");
export const persen = (n: number, total: number) => (total ? `${((n / total) * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%` : "0%");
