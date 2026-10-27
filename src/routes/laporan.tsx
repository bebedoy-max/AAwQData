import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Kerangka } from "@/components/kerangka";
import { Kartu, Tombol, angka, persen } from "@/components/ui";
import { daftarSaya } from "@/lib/daftar.functions";
import { type BarisBisnis, type StatLaporan, barisBisnis, judulKelompok, labelLevel, urutLevel } from "@/lib/laporan";
import { buatTiketLaporan, laporanBio, nomorBisnis } from "@/lib/laporan.functions";

export const Route = createFileRoute("/laporan")({
  validateSearch: z.object({ daftar: z.string().uuid().optional() }),
  component: Halaman,
});

type Daftar = Awaited<ReturnType<typeof daftarSaya>>[number];

function Halaman() {
  const { daftar: dipilih } = Route.useSearch();
  const navigate = useNavigate({ from: "/laporan" });
  const fnDaftar = useServerFn(daftarSaya);
  const fnLaporan = useServerFn(laporanBio);
  const fnTiket = useServerFn(buatTiketLaporan);
  const [semua, setSemua] = useState<Daftar[] | null>(null);
  const [stat, setStat] = useState<StatLaporan | null>(null);
  const [memuat, setMemuat] = useState(false);

  useEffect(() => {
    fnDaftar()
      .then((d) => setSemua(d.filter((x) => x.status === "selesai")))
      .catch((e: Error) => toast.error(e.message));
  }, [fnDaftar]);

  useEffect(() => {
    setStat(null);
    if (!dipilih) return;
    setMemuat(true);
    fnLaporan({ data: { daftarId: dipilih } })
      .then((r) => setStat(r.stat))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setMemuat(false));
  }, [dipilih, fnLaporan]);

  async function unduh() {
    if (!dipilih) return;
    try {
      const { url } = await fnTiket({ data: { daftarId: dipilih } });
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

  return (
    <Kerangka
      judul="Laporan Bio"
      aksi={
        stat ? (
          <Tombol varian="utama" onClick={() => void unduh()}>
            <Download className="size-4" /> Unduh laporan (.txt)
          </Tombol>
        ) : null
      }
    >
      <Kartu className="mb-4">
        <label className="block text-sm text-redup" htmlFor="pilih-daftar">
          Daftar
        </label>
        <select
          id="pilih-daftar"
          className="mt-1 w-full rounded-md border border-garis bg-panel-2 px-3 py-2"
          value={dipilih ?? ""}
          onChange={(e) => void navigate({ search: { daftar: e.target.value || undefined } })}
        >
          <option value="">— pilih daftar —</option>
          {(semua ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.nama} · {angka(d.jumlah_total)} nomor
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-redup">
          Dihitung dari hasil <b>Cek terdaftar WhatsApp</b> dan <b>skor aktif</b> daftar itu (tanpa kueri tambahan ke WhatsApp). Level dan tahun
          bisnis dibaca dari sertifikat nama bisnis WhatsApp; nomor yang dinilai sebelum fitur ini ada tercatat “level tidak diketahui”.
        </p>
      </Kartu>

      {memuat ? <p className="text-sm text-redup">Menghitung…</p> : null}
      {stat && dipilih ? <IsiLaporan daftarId={dipilih} s={stat} /> : null}
    </Kerangka>
  );
}

function Angka({ label, nilai, sub, warna }: { label: string; nilai: number; sub?: string | undefined; warna?: string }) {
  return (
    <Kartu>
      <p className="text-xs uppercase tracking-widest text-redup">{label}</p>
      <p className={`my-1 text-3xl font-bold ${warna ?? ""}`}>{angka(nilai)}</p>
      {sub ? <p className="text-xs text-redup">{sub}</p> : null}
    </Kartu>
  );
}

function IsiLaporan({ daftarId, s }: { daftarId: string; s: StatLaporan }) {
  const dicek = s.terdaftar + s.tidak_terdaftar;
  const tanpaBio = s.bio_bawaan + s.bio_kosong + s.bio_tersembunyi + s.bio_tidak_terbaca;
  const level = urutLevel(Object.keys(s.level));
  const tahun = Object.keys(s.tahun).sort();
  const maksTahun = Math.max(1, ...Object.values(s.tahun));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Angka label="Total input" nilai={s.total} sub={s.belum_pasti ? `${angka(s.belum_pasti)} belum/tidak pasti dicek` : undefined} />
        <Angka label="Terdaftar WA" nilai={s.terdaftar} sub={persen(s.terdaftar, dicek)} warna="text-siap" />
        <Angka label="Tidak terdaftar" nilai={s.tidak_terdaftar} sub={persen(s.tidak_terdaftar, dicek)} warna="text-buang" />
        <Angka label="Business Meta" nilai={s.bisnis} sub={`${persen(s.bisnis, s.terdaftar)} dari terdaftar`} warna="text-ragu" />
      </div>

      {s.terdaftar > s.dinilai ? (
        <p className="mt-3 text-xs text-ragu">
          Baru {angka(s.dinilai)} dari {angka(s.terdaftar)} nomor terdaftar yang profilnya dibaca. Nyalakan “Nilai aktivitas akun” di Pengecek WA dan
          jalankan cek pada daftar ini agar laporan lengkap.
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Kartu>
          <h2 className="mb-3 font-semibold">Bio (About) dari {angka(s.terdaftar)} terdaftar</h2>
          <Rincian
            baris={[
              ["Memiliki bio (ditulis sendiri)", s.bio_sendiri],
              ["Tanpa bio", tanpaBio],
              ["  · teks bawaan WhatsApp", s.bio_bawaan],
              ["  · kosong", s.bio_kosong],
              ["  · disembunyikan (privasi)", s.bio_tersembunyi],
              ["  · tidak terbaca", s.bio_tidak_terbaca],
              ["Akun pribadi", s.pribadi],
              ["Foto profil ada", s.foto_ada],
            ]}
          />
        </Kartu>
        <Kartu>
          <h2 className="mb-3 font-semibold">Business Meta per level</h2>
          {level.length ? <Rincian baris={level.map((l) => [labelLevel(l), s.level[l] ?? 0])} /> : <p className="text-sm text-redup">Tidak ada akun bisnis.</p>}
          {tahun.length ? (
            <>
              <h3 className="mt-4 mb-2 text-sm font-semibold">Tahun sertifikat bisnis diterbitkan</h3>
              <div className="space-y-1">
                {tahun.map((t) => (
                  <div key={t} className="flex items-center gap-2 text-xs">
                    <span className="w-10 text-redup">{t}</span>
                    <div className="h-3 flex-1 rounded bg-panel-2">
                      <div className="h-3 rounded bg-aksen" style={{ width: `${((s.tahun[t] ?? 0) / maksTahun) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right">{angka(s.tahun[t])}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </Kartu>
      </div>

      {level.map((l) => (
        <KelompokBisnis key={l} daftarId={daftarId} level={l} jumlah={s.level[l] ?? 0} />
      ))}
    </>
  );
}

function Rincian({ baris }: { baris: Array<[string, number]> }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {baris.map(([k, v]) => (
          <tr key={k} className="border-b border-garis/50 last:border-0">
            <td className={`py-1 whitespace-pre ${k.startsWith("  ") ? "text-redup" : ""}`}>{k}</td>
            <td className="py-1 text-right tabular-nums">{angka(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KelompokBisnis({ daftarId, level, jumlah }: { daftarId: string; level: string; jumlah: number }) {
  const fn = useServerFn(nomorBisnis);
  const [baris, setBaris] = useState<BarisBisnis[]>([]);
  const [buka, setBuka] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(
    async (setelah: number) => {
      setSibuk(true);
      try {
        const r = await fn({ data: { daftarId, level, setelah } });
        setBaris((b) => (setelah ? [...b, ...r] : r));
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setSibuk(false);
      }
    },
    [fn, daftarId, level],
  );

  return (
    <Kartu className="mt-4">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => {
          if (!buka && !baris.length) void muat(0);
          setBuka(!buka);
        }}
      >
        <span className="font-semibold">
          [ {judulKelompok(level)} ] <span className="text-redup">({angka(jumlah)})</span>
        </span>
        <span className="text-xs text-redup">{buka ? "Tutup" : "Lihat nomor"}</span>
      </button>
      {buka ? (
        <div className="mt-3">
          <pre className="max-h-96 overflow-auto rounded-md bg-panel-2 p-3 text-xs leading-5">{baris.map(barisBisnis).join("\n") || (sibuk ? "Memuat…" : "-")}</pre>
          {baris.length < jumlah ? (
            <Tombol className="mt-2" disabled={sibuk} onClick={() => void muat(baris.at(-1)?.id ?? 0)}>
              {sibuk ? "Memuat…" : `Muat lagi (${angka(baris.length)} / ${angka(jumlah)})`}
            </Tombol>
          ) : null}
        </div>
      ) : null}
    </Kartu>
  );
}
