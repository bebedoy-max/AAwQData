import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Kerangka } from "@/components/kerangka";
import { Kartu, Tombol } from "@/components/ui";
import { cn } from "@/lib/cn";
import { bacaPengaturanSumber, simpanSumber } from "@/lib/pengecek.functions";

export const Route = createFileRoute("/pengaturan")({ component: Halaman });

type Data = Awaited<ReturnType<typeof bacaPengaturanSumber>>;
type Sumber = Data["sumber"];

const PILIHAN: Array<{ id: Sumber; judul: string; isi: string }> = [
  {
    id: "nq",
    judul: "nq-gate (gateway pengecek terpisah)",
    isi: "Perangkat pengecek khusus yang dipasangkan di menu Pengecek WA, pada instance AABaileys terpisah dari WSPRO (WA_GATEWAY_URL).",
  },
  {
    id: "aabaileys",
    judul: "AABaileys WSPRO (perangkat WSPRO)",
    isi: "Perangkat yang tersambung di WSPRO (gateway 1 dan 2) dipakai sebagai reader. Pilih perangkat yang boleh dipakai di menu Pengecek WA (WSPRO_GATEWAYS).",
  },
];

function Halaman() {
  const fnBaca = useServerFn(bacaPengaturanSumber);
  const fnSimpan = useServerFn(simpanSumber);
  const [data, setData] = useState<Data | null>(null);
  const [pilih, setPilih] = useState<Sumber>("nq");
  const [simpan, setSimpan] = useState(false);

  const muat = useCallback(() => {
    fnBaca()
      .then((d) => {
        setData(d);
        setPilih(d.sumber);
      })
      .catch((e: Error) => toast.error(e.message));
  }, [fnBaca]);
  useEffect(muat, [muat]);

  const siap = (s: Sumber) => (s === "nq" ? data?.nq.terkonfigurasi : data?.wspro.terkonfigurasi);

  async function terapkan() {
    setSimpan(true);
    try {
      await fnSimpan({ data: { sumber: pilih } });
      toast.success("Sumber reader disimpan");
      muat();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSimpan(false);
    }
  }

  return (
    <Kerangka judul="Pengaturan">
      <Kartu className="max-w-3xl">
        <h2 className="font-semibold">Sumber reader (perangkat pengecek)</h2>
        <p className="mt-1 text-sm text-redup">Perangkat mana yang dipakai untuk cek terdaftar WhatsApp dan skor aktif. Daftar yang sedang dicek ikut berpindah sumber.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PILIHAN.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPilih(p.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                pilih === p.id ? "border-aksen bg-aksen/10" : "border-garis hover:border-redup",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("size-3 rounded-full border", pilih === p.id ? "border-aksen bg-aksen" : "border-redup")} />
                <span className="font-medium">{p.judul}</span>
              </div>
              <p className="mt-2 text-xs text-redup">{p.isi}</p>
              <p className={cn("mt-2 text-xs", siap(p.id) ? "text-siap" : "text-ragu")}>
                {data ? (siap(p.id) ? `Terhubung ke ${(p.id === "nq" ? [data.nq.url] : data.wspro.url).join(", ")}` : "Belum diatur di server") : "Memuat…"}
              </p>
              {data?.sumber === p.id ? <p className="mt-1 text-xs text-aksen">Sedang dipakai</p> : null}
            </button>
          ))}
        </div>
        <Tombol varian="utama" className="mt-4" disabled={!data || simpan || pilih === data.sumber} onClick={() => void terapkan()}>
          Simpan
        </Tombol>
      </Kartu>
    </Kerangka>
  );
}
