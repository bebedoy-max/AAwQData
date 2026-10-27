import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Kerangka } from "@/components/kerangka";
import { BatangKategori, Kartu, LABEL_KATEGORI, TEKS_KATEGORI, Tombol, angka, persen } from "@/components/ui";
import { buatTiketEkspor, contohNomor, detailDaftar, hapusDaftar, selesaikanUnggah } from "@/lib/daftar.functions";
import { ALASAN, type KodeAlasan } from "@/lib/kualitas";
import { namaNegara } from "@/lib/negara";

export const Route = createFileRoute("/daftar/$id")({ component: Halaman });

type Detail = Awaited<ReturnType<typeof detailDaftar>>;
type Contoh = Awaited<ReturnType<typeof contohNomor>>;
type Kat = "siap" | "ragu" | "buang";

function Halaman() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const fnDetail = useServerFn(detailDaftar);
  const fnContoh = useServerFn(contohNomor);
  const fnTiket = useServerFn(buatTiketEkspor);
  const fnHapus = useServerFn(hapusDaftar);
  const fnSelesai = useServerFn(selesaikanUnggah);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [saring, setSaring] = useState<{ kategori?: Kat; alasan?: string }>({});
  const [halaman, setHalaman] = useState(0);
  const [contoh, setContoh] = useState<Contoh | null>(null);

  const muat = useCallback(() => {
    fnDetail({ data: { daftarId: id } })
      .then(setDetail)
      .catch((e: Error) => setGalat(e.message));
  }, [fnDetail, id]);
  useEffect(muat, [muat]);

  useEffect(() => {
    setContoh(null);
    fnContoh({ data: { daftarId: id, ...saring, halaman } })
      .then(setContoh)
      .catch((e: Error) => toast.error(e.message));
  }, [fnContoh, id, saring, halaman]);

  async function unduh(kategori: Kat | "semua", format: "lengkap" | "nomor") {
    try {
      const { url } = await fnTiket({ data: { daftarId: id, kategori, format } });
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (galat) return <Kerangka judul="Daftar">{<p className="text-buang">{galat}</p>}</Kerangka>;
  if (!detail) return <Kerangka judul="Daftar">{<p className="text-sm text-redup">Memuat…</p>}</Kerangka>;
  const { daftar: d, ringkasan: r } = detail;
  const total = d.jumlah_total;
  const alasan = Object.entries(r.alasan).sort((a, b) => b[1] - a[1]);

  return (
    <Kerangka
      judul={d.nama}
      aksi={
        <Tombol
          varian="bahaya"
          onClick={async () => {
            if (!confirm(`Hapus daftar "${d.nama}" beserta ${angka(total)} nomornya?`)) return;
            await fnHapus({ data: { daftarId: id } });
            void navigate({ to: "/daftar" });
          }}
        >
          <Trash2 className="size-4" /> Hapus
        </Tombol>
      }
    >
      {d.status !== "selesai" ? (
        <Kartu className="mb-4 border-ragu/40">
          <p className="text-sm text-ragu">
            {d.status === "gagal" ? `Analisis gagal: ${d.galat ?? ""}` : d.status === "mengunggah" ? "Unggahan daftar ini belum selesai (halaman ditutup atau koneksi putus)." : "Daftar sedang dianalisis."}
          </p>
          <Tombol className="mt-3" onClick={() => void fnSelesai({ data: { daftarId: id } }).then(muat, (e: Error) => toast.error(e.message))}>
            Analisis dengan nomor yang sudah masuk
          </Tombol>
        </Kartu>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <Kartu className="text-center">
          <p className="text-xs uppercase tracking-widest text-redup">Siap kirim</p>
          <p className="my-2 text-5xl font-bold text-siap">{persen(d.jumlah_siap, total)}</p>
          <p className="text-sm text-redup">
            {angka(d.jumlah_siap)} dari {angka(total)} nomor
          </p>
          <BatangKategori className="mt-4" siap={d.jumlah_siap} ragu={d.jumlah_ragu} buang={d.jumlah_buang} />
          <p className="mt-3 text-xs text-redup">{(d.negara_target as string[]).map(namaNegara).join(", ") || "Semua negara"}</p>
        </Kartu>

        <div className="grid gap-3 sm:grid-cols-3">
          {(["siap", "ragu", "buang"] as const).map((k) => {
            const n = { siap: d.jumlah_siap, ragu: d.jumlah_ragu, buang: d.jumlah_buang }[k];
            return (
              <Kartu key={k}>
                <p className={`text-sm font-semibold ${TEKS_KATEGORI[k]}`}>{LABEL_KATEGORI[k]}</p>
                <p className="mt-1 text-2xl font-bold">{angka(n)}</p>
                <p className="text-xs text-redup">{persen(n, total)}</p>
                <div className="mt-3 flex flex-col gap-2">
                  <Tombol disabled={!n} onClick={() => void unduh(k, "nomor")} className="text-xs">
                    <Download className="size-3" /> Nomor saja (CSV)
                  </Tombol>
                  <Tombol varian="tipis" disabled={!n} onClick={() => void unduh(k, "lengkap")} className="min-h-8 text-xs">
                    Lengkap + alasan
                  </Tombol>
                </div>
              </Kartu>
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
        <Kartu>
          <h2 className="mb-3 font-semibold">Alasan</h2>
          {!alasan.length ? <p className="text-sm text-redup">Tidak ada masalah ditemukan.</p> : null}
          <ul className="space-y-3">
            {alasan.map(([a, n]) => {
              const info = ALASAN[a as KodeAlasan];
              return (
                <li key={a}>
                  <button type="button" className="w-full text-left" onClick={() => (setHalaman(0), setSaring({ alasan: a }))}>
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className={info?.kategori === "buang" ? "text-buang" : "text-ragu"}>●</span>
                      <span className="flex-1 font-medium">{info?.label ?? a}</span>
                      <span className="font-mono">{angka(n)}</span>
                      <span className="w-14 text-right text-xs text-redup">{persen(n, total)}</span>
                    </div>
                    <p className="ml-5 text-xs text-redup">{info?.penjelasan}</p>
                  </button>
                </li>
              );
            })}
          </ul>
          {r.dikoreksi ? <p className="mt-4 text-xs text-ragu">{angka(r.dikoreksi)} nomor dikoreksi kode negaranya (lihat kolom "koreksi dari" di unduhan lengkap).</p> : null}
        </Kartu>
        <Kartu>
          <h2 className="mb-3 font-semibold">Negara terbaca</h2>
          <ul className="space-y-1 text-sm">
            {r.negara.map((g) => (
              <li key={g.negara} className="flex gap-2">
                <span className="flex-1">{g.negara === "?" ? "Tidak terbaca" : namaNegara(g.negara)}</span>
                <span className="font-mono">{angka(g.jumlah)}</span>
              </li>
            ))}
          </ul>
        </Kartu>
      </div>

      <Kartu className="mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex-1 font-semibold">Tinjau nomor</h2>
          {(["siap", "ragu", "buang"] as const).map((k) => (
            <Tombol key={k} varian={saring.kategori === k ? "utama" : "biasa"} className="min-h-8 text-xs" onClick={() => (setHalaman(0), setSaring(saring.kategori === k ? {} : { kategori: k }))}>
              {LABEL_KATEGORI[k]}
            </Tombol>
          ))}
          {saring.alasan ? (
            <Tombol className="min-h-8 text-xs" onClick={() => (setHalaman(0), setSaring({}))}>
              {ALASAN[saring.alasan as KodeAlasan]?.label ?? saring.alasan} ✕
            </Tombol>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-redup">
              <tr>
                <th className="py-1 pr-3">Baris</th>
                <th className="py-1 pr-3">Asli</th>
                <th className="py-1 pr-3">Nomor</th>
                <th className="py-1 pr-3">Negara</th>
                <th className="py-1 pr-3">Skor</th>
                <th className="py-1">Alasan</th>
              </tr>
            </thead>
            <tbody>
              {(contoh ?? []).map((b) => (
                <tr key={b.baris} className="border-t border-garis">
                  <td className="py-1 pr-3 font-mono text-xs text-redup">{b.baris}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{b.mentah}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{b.e164 ? `+${b.e164}` : "-"}</td>
                  <td className="py-1 pr-3 text-xs">{b.negara ?? "-"}</td>
                  <td className={`py-1 pr-3 font-mono text-xs ${TEKS_KATEGORI[b.kategori as Kat]}`}>{b.skor}</td>
                  <td className="py-1 text-xs text-redup">{(b.alasan as string[]).map((a) => ALASAN[a as KodeAlasan]?.label ?? a).join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {contoh && !contoh.length ? <p className="py-4 text-center text-sm text-redup">Tidak ada nomor.</p> : null}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2 text-sm">
          <Tombol varian="tipis" disabled={!halaman} onClick={() => setHalaman(halaman - 1)}>
            ‹ Sebelumnya
          </Tombol>
          <span className="text-redup">Halaman {halaman + 1}</span>
          <Tombol varian="tipis" disabled={(contoh?.length ?? 0) < 50} onClick={() => setHalaman(halaman + 1)}>
            Berikutnya ›
          </Tombol>
        </div>
      </Kartu>
    </Kerangka>
  );
}
