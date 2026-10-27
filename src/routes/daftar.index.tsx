import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Kerangka } from "@/components/kerangka";
import { BatangKategori, Kartu, Tombol, angka, persen } from "@/components/ui";
import { daftarSaya } from "@/lib/daftar.functions";
import { namaNegara } from "@/lib/negara";

export const Route = createFileRoute("/daftar/")({ component: Halaman });

type Baris = Awaited<ReturnType<typeof daftarSaya>>[number];

const STATUS: Record<string, string> = { mengunggah: "Belum selesai diunggah", menganalisis: "Sedang dianalisis", selesai: "Selesai", gagal: "Gagal" };

function Halaman() {
  const ambil = useServerFn(daftarSaya);
  const [data, setData] = useState<Baris[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    ambil()
      .then(setData)
      .catch((e: Error) => setGalat(e.message));
  }, [ambil]);

  return (
    <Kerangka
      judul="Daftar nomor"
      aksi={
        <Link to="/daftar/baru">
          <Tombol varian="utama">
            <Plus className="size-4" /> Periksa daftar baru
          </Tombol>
        </Link>
      }
    >
      {galat ? <p className="text-sm text-buang">{galat}</p> : null}
      {data && !data.length ? (
        <Kartu className="text-center">
          <p className="text-redup">Belum ada daftar. Unggah CSV/Excel berisi nomor target untuk diperiksa kualitasnya sebelum dikirim.</p>
        </Kartu>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {(data ?? []).map((d) => (
          <Link key={d.id} to="/daftar/$id" params={{ id: d.id }} className="block">
            <Kartu className="transition hover:border-aksen/60">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-semibold">{d.nama}</h2>
                  <p className="text-xs text-redup">
                    {(d.negara_target as string[]).map(namaNegara).join(", ") || "Semua negara"} · {new Date(d.dibuat).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}
                  </p>
                </div>
                <span className={d.status === "selesai" ? "text-xs text-siap" : d.status === "gagal" ? "text-xs text-buang" : "text-xs text-ragu"}>{STATUS[d.status] ?? d.status}</span>
              </div>
              <BatangKategori className="mt-3" siap={d.jumlah_siap} ragu={d.jumlah_ragu} buang={d.jumlah_buang} />
              <p className="mt-2 text-sm">
                <span className="text-siap">{persen(d.jumlah_siap, d.jumlah_total)} siap kirim</span>
                <span className="text-redup"> · {angka(d.jumlah_total)} nomor</span>
              </p>
            </Kartu>
          </Link>
        ))}
      </div>
    </Kerangka>
  );
}
