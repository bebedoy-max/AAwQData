import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileUp, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Kerangka } from "@/components/kerangka";
import { Kartu, Tombol, angka } from "@/components/ui";
import { bacaBerkas, dariTeks, tebakKolomNomor, type Tabel } from "@/lib/berkas";
import { UKURAN_POTONGAN, buatDaftar, selesaikanUnggah, unggahPotongan } from "@/lib/daftar.functions";
import { DAFTAR_NEGARA, namaNegara } from "@/lib/negara";

export const Route = createFileRoute("/daftar/baru")({ component: Halaman });

function Halaman() {
  const navigate = useNavigate();
  const fnBuat = useServerFn(buatDaftar);
  const fnUnggah = useServerFn(unggahPotongan);
  const fnSelesai = useServerFn(selesaikanUnggah);

  const [nama, setNama] = useState("");
  const [negara, setNegara] = useState<string[]>([]);
  const [cariNegara, setCariNegara] = useState("");
  const [koreksi, setKoreksi] = useState(true);
  const [tabel, setTabel] = useState<Tabel | null>(null);
  const [kolom, setKolom] = useState(0);
  const [teks, setTeks] = useState("");
  const [membaca, setMembaca] = useState(false);
  const [kemajuan, setKemajuan] = useState<{ selesai: number; total: number; tahap: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const saranNegara = useMemo(() => {
    const q = cariNegara.trim().toLowerCase();
    return DAFTAR_NEGARA.filter((n) => !negara.includes(n.kode) && (!q || n.nama.toLowerCase().includes(q) || n.kode.toLowerCase() === q || n.kodeTelepon === q.replace("+", ""))).slice(0, q ? 12 : 8);
  }, [cariNegara, negara]);

  async function pilihBerkas(f: File | undefined) {
    if (!f) return;
    setMembaca(true);
    try {
      const t = await bacaBerkas(f);
      if (!t.baris.length) throw new Error("Berkas tidak berisi data.");
      setTabel(t);
      setKolom(tebakKolomNomor(t));
      if (!nama) setNama(f.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      toast.error(`Gagal membaca berkas: ${(e as Error).message}`);
    } finally {
      setMembaca(false);
    }
  }

  async function mulai() {
    const t = tabel ?? (teks.trim() ? dariTeks(teks) : null);
    if (!t) {
      toast.error("Pilih berkas atau tempel nomor dulu.");
      return;
    }
    if (!nama.trim()) {
      toast.error("Isi nama daftar.");
      return;
    }
    const k = tabel ? kolom : 0;
    // Satu nomor per baris teks; baris baru di dalam sel CSV diganti spasi agar penomoran baris tetap.
    const nomor = t.baris.map((b) => String(b[k] ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200));
    setKemajuan({ selesai: 0, total: nomor.length, tahap: "Menyiapkan daftar…" });
    try {
      const { id } = await fnBuat({ data: { nama: nama.trim(), negaraTarget: negara, koreksiKodeNegara: koreksi } });
      for (let i = 0; i < nomor.length; i += UKURAN_POTONGAN) {
        const potong = nomor.slice(i, i + UKURAN_POTONGAN);
        // Ulangi potongan yang gagal (jaringan HP putus-sambung) sebelum menyerah.
        for (let coba = 1; ; coba++) {
          try {
            await fnUnggah({ data: { daftarId: id, mulai: i + 1, teks: potong.join("\n") } });
            break;
          } catch (e) {
            if (coba >= 3) throw e;
            await new Promise((r) => setTimeout(r, 1500 * coba));
          }
        }
        setKemajuan({ selesai: Math.min(i + potong.length, nomor.length), total: nomor.length, tahap: "Memeriksa dan menyimpan nomor…" });
      }
      setKemajuan({ selesai: nomor.length, total: nomor.length, tahap: "Menganalisis duplikat dan deret nomor…" });
      await fnSelesai({ data: { daftarId: id } });
      toast.success("Pemeriksaan selesai");
      void navigate({ to: "/daftar/$id", params: { id } });
    } catch (e) {
      toast.error((e as Error).message);
      setKemajuan(null);
    }
  }

  const jumlah = tabel ? tabel.baris.length : teks.trim() ? dariTeks(teks).baris.length : 0;
  const sibuk = !!kemajuan;

  return (
    <Kerangka judul="Periksa daftar baru">
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Kartu>
            <h2 className="mb-3 font-semibold">1. Nomor target</h2>
            {!tabel ? (
              <>
                <input ref={input} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm,.ods" className="hidden" onChange={(e) => void pilihBerkas(e.target.files?.[0])} />
                <button
                  type="button"
                  disabled={membaca || sibuk}
                  onClick={() => input.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void pilihBerkas(e.dataTransfer.files[0]);
                  }}
                  className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-garis p-8 text-redup hover:border-aksen/60 hover:text-teks"
                >
                  <FileUp className="size-8" />
                  <span>{membaca ? "Membaca berkas…" : "Pilih atau seret berkas CSV / Excel / TXT"}</span>
                  <span className="text-xs">Ratusan ribu baris tidak masalah</span>
                </button>
                <p className="my-3 text-center text-xs text-redup">atau tempel nomor (satu per baris)</p>
                <textarea
                  value={teks}
                  onChange={(e) => setTeks(e.target.value)}
                  rows={5}
                  disabled={sibuk}
                  placeholder={"+62 812-3456-7890\n0812 9876 5432\n85291873264"}
                  className="w-full rounded-md border border-garis bg-panel-2 px-3 py-2 font-mono text-sm"
                />
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex-1">
                    {angka(tabel.baris.length)} baris{tabel.adaJudul ? " (baris pertama dipakai sebagai judul kolom)" : ""}
                  </span>
                  <Tombol varian="tipis" disabled={sibuk} onClick={() => setTabel(null)} aria-label="Ganti berkas">
                    <X className="size-4" /> Ganti
                  </Tombol>
                </div>
                <label className="block text-sm text-redup">
                  Kolom nomor
                  <select value={kolom} disabled={sibuk} onChange={(e) => setKolom(Number(e.target.value))} className="mt-1 w-full rounded-md border border-garis bg-panel-2 px-3 py-2 text-teks">
                    {tabel.kolom.map((k, i) => (
                      <option key={i} value={i}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="overflow-x-auto rounded-md border border-garis">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-panel-2 text-redup">
                      <tr>
                        {tabel.kolom.map((k, i) => (
                          <th key={i} className={i === kolom ? "px-2 py-1 text-aksen" : "px-2 py-1"}>
                            {k}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {tabel.baris.slice(0, 5).map((b, r) => (
                        <tr key={r} className="border-t border-garis">
                          {tabel.kolom.map((_, i) => (
                            <td key={i} className={i === kolom ? "px-2 py-1 text-aksen" : "px-2 py-1"}>
                              {b[i]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Kartu>

          <Kartu>
            <h2 className="mb-1 font-semibold">2. Negara target kampanye</h2>
            <p className="mb-3 text-xs text-redup">Nomor di luar negara ini dibuang. Kosongkan bila semua negara boleh.</p>
            <div className="mb-2 flex flex-wrap gap-2">
              {negara.map((k) => (
                <button key={k} type="button" disabled={sibuk} onClick={() => setNegara(negara.filter((x) => x !== k))} className="inline-flex items-center gap-1 rounded-full bg-aksen/15 px-3 py-1 text-sm text-aksen">
                  {namaNegara(k)} <X className="size-3" />
                </button>
              ))}
            </div>
            <input
              value={cariNegara}
              disabled={sibuk}
              onChange={(e) => setCariNegara(e.target.value)}
              placeholder="Cari negara atau kode (mis. Brasil, HK, 852)"
              className="w-full rounded-md border border-garis bg-panel-2 px-3 py-2 text-sm"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {saranNegara.map((n) => (
                <button
                  key={n.kode}
                  type="button"
                  disabled={sibuk}
                  onClick={() => {
                    setNegara([...negara, n.kode]);
                    setCariNegara("");
                  }}
                  className="rounded-full border border-garis px-3 py-1 text-xs text-redup hover:border-aksen/60 hover:text-teks"
                >
                  {n.nama} +{n.kodeTelepon}
                </button>
              ))}
            </div>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={koreksi} disabled={sibuk} onChange={(e) => setKoreksi(e.target.checked)} className="mt-1" />
              <span>
                Koreksi otomatis nomor yang salah kode negara
                <span className="block text-xs text-redup">Mis. nomor lokal Hong Kong yang terlanjur diberi awalan 62 diubah ke +852 dan ditandai Ragu.</span>
              </span>
            </label>
          </Kartu>
        </div>

        <Kartu className="h-fit space-y-3 lg:sticky lg:top-20">
          <h2 className="font-semibold">3. Mulai periksa</h2>
          <label className="block text-sm text-redup">
            Nama daftar
            <input value={nama} disabled={sibuk} onChange={(e) => setNama(e.target.value)} maxLength={120} className="mt-1 w-full rounded-md border border-garis bg-panel-2 px-3 py-2 text-teks" />
          </label>
          <p className="text-sm text-redup">
            {angka(jumlah)} nomor · {negara.length ? negara.map(namaNegara).join(", ") : "semua negara"}
          </p>
          {kemajuan ? (
            <div aria-live="polite">
              <div className="h-2 overflow-hidden rounded bg-panel-2">
                <div className="h-full bg-aksen transition-all" style={{ width: `${kemajuan.total ? (kemajuan.selesai / kemajuan.total) * 100 : 0}%` }} />
              </div>
              <p className="mt-2 text-xs text-redup">
                {kemajuan.tahap} {angka(kemajuan.selesai)} / {angka(kemajuan.total)}
              </p>
              <p className="mt-1 text-xs text-redup">Jangan tutup halaman ini sampai selesai.</p>
            </div>
          ) : (
            <Tombol varian="utama" className="w-full" disabled={!jumlah || membaca} onClick={() => void mulai()}>
              Periksa {jumlah ? angka(jumlah) : ""} nomor
            </Tombol>
          )}
        </Kartu>
      </div>
    </Kerangka>
  );
}
