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
import { teksDurasi } from "@/lib/jadwal-cek";
import { ATURAN_AKTIF_BAWAAN, nilaiAktivitas, type SinyalWa } from "@/lib/aktivitas";
import { jedaCekWa, mulaiCekWa, progresCekWa } from "@/lib/pengecek.functions";

export const Route = createFileRoute("/daftar/$id")({ component: Halaman });

type Progres = Awaited<ReturnType<typeof progresCekWa>>;

/** Rincian poin skor aktif (tooltip di tabel tinjau), dihitung ulang dari sinyal mentah. */
const rincianAktif = (s: SinyalWa) =>
  nilaiAktivitas(s, ATURAN_AKTIF_BAWAAN)
    .poin.map((x) => `${x.label}: ${x.keterangan}${x.poin === null ? " (tidak dihitung)" : ` = ${x.poin}`}`)
    .concat(s.business || s.hosted ? ["Akun bisnis"] : [])
    .join("\n");

/** Cek terdaftar WhatsApp untuk nomor Siap/Ragu: berjalan di server, kartu ini hanya memantau. */
function KartuCekWa({
  daftarId,
  onBerubah,
  onUnduh,
}: {
  daftarId: string;
  onBerubah: () => void;
  onUnduh: (format: "lengkap" | "nomor", kategori?: "terdaftar" | "aktif" | "grade_a" | "grade_b" | "grade_c") => void;
}) {
  const fnProgres = useServerFn(progresCekWa);
  const fnMulai = useServerFn(mulaiCekWa);
  const fnJeda = useServerFn(jedaCekWa);
  const [p, setP] = useState<Progres | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(
    () =>
      fnProgres({ data: { daftarId } })
        .then((x) => {
          setP((lama) => {
            // Angka kategori ikut berubah selama cek berjalan: segarkan ringkasan daftar.
            if (lama && (lama.terdaftar !== x.terdaftar || lama.tidak_terdaftar !== x.tidak_terdaftar)) onBerubah();
            return x;
          });
        })
        .catch((e: Error) => toast.error(e.message)),
    [fnProgres, daftarId, onBerubah],
  );
  useEffect(() => {
    void muat();
  }, [muat]);
  useEffect(() => {
    if (p?.status !== "berjalan") return;
    const t = setInterval(() => void muat(), 5000);
    return () => clearInterval(t);
  }, [p?.status, muat]);

  if (!p) return null;
  const dicek = p.terdaftar + p.tidak_terdaftar + p.tidak_pasti;
  const total = dicek + p.sisa;
  const aksi = async (fn: () => Promise<unknown>) => {
    setSibuk(true);
    try {
      await fn();
      await muat();
      onBerubah();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSibuk(false);
    }
  };

  return (
    <Kartu className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">Cek terdaftar WhatsApp</h2>
        {p.status === "berjalan" ? (
          <Tombol disabled={sibuk} onClick={() => void aksi(() => fnJeda({ data: { daftarId } }))}>
            Jeda
          </Tombol>
        ) : p.sisa > 0 || p.status === "belum" ? (
          <Tombol varian="utama" disabled={sibuk} onClick={() => void aksi(async () => {
            const r = await fnMulai({ data: { daftarId } });
            if (r.dariCache) toast.success(`${angka(r.dariCache)} nomor memakai hasil cek sebelumnya`);
          })}>
            {p.status === "jeda" ? "Lanjutkan cek" : "Mulai cek WhatsApp"}
          </Tombol>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-redup">
        Nomor Siap dan Ragu dicek lewat perangkat pengecek: tidak terdaftar pindah ke Buang, lalu yang terdaftar diberi skor aktif (perangkat, About, foto, akun bisnis).
      </p>
      {total ? (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded bg-panel-2">
            <div className="h-full bg-aksen transition-all" style={{ width: `${(dicek / total) * 100}%` }} />
          </div>
          <p className="mt-2 text-sm">
            {angka(dicek)} / {angka(total)} dicek · <span className="text-siap">{angka(p.terdaftar)} terdaftar</span> · <span className="text-buang">{angka(p.tidak_terdaftar)} tidak terdaftar</span>
            {p.tidak_pasti ? <span className="text-ragu"> · {angka(p.tidak_pasti)} tidak pasti</span> : null}
          </p>
          {p.terdaftar ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Tombol onClick={() => onUnduh("nomor")}>
                <Download className="size-4" /> Terdaftar WA: nomor saja (CSV)
              </Tombol>
              <Tombol onClick={() => onUnduh("lengkap")}>
                <Download className="size-4" /> Terdaftar WA: lengkap
              </Tombol>
            </div>
          ) : null}
        </div>
      ) : null}
      {p.cekAktivitas && (p.aktif_dinilai || p.aktif_sisa) ? (
        <div className="mt-3 border-t border-garis pt-3">
          <p className="text-sm font-medium">
            Skor aktif {p.skor_rata !== null ? <span className="text-aksen">rata-rata {p.skor_rata}</span> : null}
            <span className="text-xs text-redup"> · {angka(p.aktif_dinilai)} dinilai{p.aktif_sisa ? `, ${angka(p.aktif_sisa)} menunggu` : ""}</span>
          </p>
          <p className="mt-1 text-sm">
            <span className="text-siap">{angka(p.aktif_baik)} aktif</span> · <span className="text-ragu">{angka(p.aktif_rendah)} aktivitas rendah</span> ·{" "}
            <span className="text-buang">{angka(p.tidak_aktif)} kemungkinan tidak aktif</span>
            {p.bisnis ? <span className="text-ragu"> · {angka(p.bisnis)} akun bisnis</span> : null}
          </p>
          {p.grade ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(
                [
                  ["grade_a", "A", p.grade.a, "text-siap", `aktivitas ≤ ${p.gradeHari.a} hari`],
                  ["grade_b", "B", p.grade.b, "text-aksen", `aktivitas ≤ ${p.gradeHari.b} hari`],
                  ["grade_c", "C", p.grade.c, "text-ragu", `lebih lama / tanpa tanggal`],
                ] as const
              ).map(([k, huruf, n, warna, ket]) => (
                <div key={k} className="rounded-md border border-garis p-2">
                  <p className="text-sm">
                    <b className={warna}>Grade {huruf}</b> · {angka(n)} nomor
                  </p>
                  <p className="text-xs text-redup">{ket}</p>
                  <div className="mt-2 flex gap-1">
                    <Tombol className="min-h-8 flex-1 text-xs" disabled={!n} onClick={() => onUnduh("nomor", k)}>
                      <Download className="size-3" /> Nomor
                    </Tombol>
                    <Tombol varian="tipis" className="min-h-8 flex-1 text-xs" disabled={!n} onClick={() => onUnduh("lengkap", k)}>
                      Lengkap
                    </Tombol>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {p.aktif_baik ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Tombol onClick={() => onUnduh("nomor", "aktif")}>
                <Download className="size-4" /> Aktif: nomor saja (CSV)
              </Tombol>
              <Tombol onClick={() => onUnduh("lengkap", "aktif")}>
                <Download className="size-4" /> Aktif: lengkap
              </Tombol>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="mt-1 text-xs text-redup">
        {p.status === "selesai"
          ? "Selesai."
          : p.status === "jeda"
            ? "Dijeda."
            : `Perangkat siap: ${p.perangkatSiap} dari ${p.perangkatTotal}${p.sisa || p.aktif_sisa ? ` · perkiraan ${teksDurasi(p.perkiraanDetik)}` : ""}`}
        {!p.perangkatTotal ? " Tambahkan perangkat di menu Pengecek WA." : ""}
      </p>
    </Kartu>
  );
}

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

  async function unduh(kategori: Kat | "semua" | "terdaftar" | "aktif" | "grade_a" | "grade_b" | "grade_c", format: "lengkap" | "nomor") {
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

      {d.status === "selesai" ? <KartuCekWa daftarId={id} onBerubah={muat} onUnduh={(f, k) => void unduh(k ?? "terdaftar", f)} /> : null}

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
                <th className="py-1 pr-3">Aktif</th>
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
                  <td className="py-1 pr-3 font-mono text-xs" title={b.aktif_sinyal ? rincianAktif(b.aktif_sinyal as SinyalWa) : undefined}>
                    {b.aktif_skor ?? (b.wa === true ? "…" : b.wa === false ? "✕" : "-")}
                  </td>
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
