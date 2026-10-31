import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Kerangka } from "@/components/kerangka";
import { Kartu, Tombol, angka } from "@/components/ui";
import { cekHariIni } from "@/lib/jadwal-cek";
import { aturSemuaWspro, daftarPengecek, hapusPengecek, kodePairing, segarkanReaderWspro, simpanAturan, statusPemasangan, tambahPengecek, ubahPengecek } from "@/lib/pengecek.functions";

export const Route = createFileRoute("/pengecek")({ component: Halaman });

type Data = Awaited<ReturnType<typeof daftarPengecek>>;

const waktu = (s: string | null) => (s ? new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-");

function Halaman() {
  const fnDaftar = useServerFn(daftarPengecek);
  const fnTambah = useServerFn(tambahPengecek);
  const fnUbah = useServerFn(ubahPengecek);
  const fnHapus = useServerFn(hapusPengecek);
  const fnSemua = useServerFn(aturSemuaWspro);
  const fnSegarkan = useServerFn(segarkanReaderWspro);
  const [segarSibuk, setSegarSibuk] = useState(false);
  const [autoSegar, setAutoSegar] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [pasang, setPasang] = useState<string | null>(null);
  const [nama, setNama] = useState("");

  const muat = useCallback(() => {
    fnDaftar()
      .then(setData)
      .catch((e: Error) => toast.error(e.message));
  }, [fnDaftar]);
  useEffect(() => {
    muat();
    const t = setInterval(muat, 15_000);
    return () => clearInterval(t);
  }, [muat]);

  // Refresh reader WSPRO: dipakai tombol dan auto-refresh. diam = true saat auto (tanpa notifikasi tiap putaran).
  const segarkan = useCallback(
    (diam = false) => {
      setSegarSibuk(true);
      return fnSegarkan()
        .then((r) => {
          if (!diam) toast.success(`${r.reader} reader tersambung${r.dibuang ? ` · ${r.dibuang} terputus dibuang` : ""}`);
          return muat();
        })
        .catch((e: Error) => toast.error(e.message))
        .finally(() => setSegarSibuk(false));
    },
    [fnSegarkan, muat],
  );

  // Ingat pilihan auto-refresh (per peramban).
  useEffect(() => {
    try {
      if (localStorage.getItem("aawq_auto_segar") === "1") setAutoSegar(true);
    } catch {
      /* abaikan */
    }
  }, []);

  // Auto-refresh tiap 30 detik selama dinyalakan, supaya tak perlu klik manual saat ditinggal.
  useEffect(() => {
    if (!autoSegar) return;
    void segarkan(true);
    const t = setInterval(() => void segarkan(true), 30_000);
    return () => clearInterval(t);
  }, [autoSegar, segarkan]);

  const wspro = data?.sumber === "aabaileys";
  const aktifCount = (data?.perangkat ?? []).filter((p) => p.aktif).length;

  async function tambah() {
    if (!nama.trim()) return void toast.error("Isi nama perangkat.");
    try {
      const { id } = await fnTambah({ data: { nama: nama.trim() } });
      setNama("");
      setPasang(id);
      muat();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Kerangka judul="Perangkat pengecek WhatsApp">
      {data && !data.gateway ? (
        <Kartu className="mb-4 border-ragu/40 text-sm text-ragu">
          {wspro
            ? "Gateway WSPRO belum diatur di server: isi WSPRO_GATEWAYS (url|kunci gateway AABaileys WSPRO, dipisah koma)."
            : "Gateway belum diatur di server: isi WA_GATEWAY_URL dan WA_GATEWAY_API_KEY (instance AABaileys terpisah dari WSPRO)."}
        </Kartu>
      ) : null}
      {data?.galatSinkron?.length ? <Kartu className="mb-4 border-ragu/40 text-sm text-ragu">Gagal membaca perangkat WSPRO: {data.galatSinkron.join("; ")}</Kartu> : null}
      {wspro ? (
        <Kartu className="mb-4 text-sm text-redup">
          Sumber reader: <b className="text-teks">perangkat WSPRO</b> (ubah di <Link to="/pengaturan" className="text-aksen underline">Pengaturan</Link>). Daftar di bawah adalah perangkat yang
          sedang tersambung di gateway WSPRO. Perangkat baru masuk <b className="text-teks">nonaktif</b>: aktifkan yang boleh dipakai mengecek. AAwQData tidak pernah memasangkan atau
          menghapus perangkat WSPRO. Cek massal bisa membuat nomor dibatasi WhatsApp untuk cek; pembatasan cek terpisah dari pengiriman, jadi blast perangkat itu tidak ikut ditahan.
        </Kartu>
      ) : (
        <Kartu className="mb-4 text-sm text-redup">
          Pakai <b className="text-teks">nomor WhatsApp khusus</b> untuk mengecek (bukan nomor blast). Cek massal bisa membuat nomor dibatasi WhatsApp; bila itu terjadi perangkat ditahan
          otomatis dan perangkat lain tetap bekerja. Lebih banyak perangkat = pengecekan lebih cepat.
        </Kartu>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {(data?.perangkat ?? []).map((p) => (
            <Kartu key={p.id}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{p.nama}</h2>
                  <p className="text-xs text-redup">{p.nomor ? `+${p.nomor}` : "belum dipasangkan"} · {p.status}</p>
                </div>
                <span className={p.kesiapan.siap ? "text-sm text-siap" : "text-sm text-ragu"}>{p.kesiapan.alasan}</span>
              </div>
              <p className="mt-2 text-xs text-redup">
                Hari ini {angka(cekHariIni(p, new Date()))}
                {data?.aturan.batas_harian ? ` / ${angka(data.aturan.batas_harian)}` : ""} nomor · total {angka(Number(p.total_cek))} · terakhir {waktu(p.terakhir_cek)}
              </p>
              {p.ditahan_sampai && Date.parse(p.ditahan_sampai) > Date.now() ? (
                <p className="mt-1 text-xs text-ragu">
                  Ditahan sampai {waktu(p.ditahan_sampai)}: {p.alasan_tahan}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {!wspro && p.status !== "WORKING" ? (
                  <Tombol varian="utama" className="min-h-8 text-xs" onClick={() => setPasang(p.id)}>
                    Pasangkan
                  </Tombol>
                ) : null}
                <Tombol className="min-h-8 text-xs" onClick={() => void fnUbah({ data: { id: p.id, aktif: !p.aktif } }).then(muat, (e: Error) => toast.error(e.message))}>
                  {p.aktif ? "Nonaktifkan" : "Aktifkan"}
                </Tombol>
                {p.ditahan_sampai ? (
                  <Tombol
                    className="min-h-8 text-xs"
                    onClick={() => {
                      if (!confirm("Lepas penahanan? Hanya lakukan bila yakin nomor ini tidak sedang dibatasi WhatsApp.")) return;
                      void fnUbah({ data: { id: p.id, lepasTahan: true } }).then(muat, (e: Error) => toast.error(e.message));
                    }}
                  >
                    <RotateCcw className="size-3" /> Lepas tahan
                  </Tombol>
                ) : null}
                {!wspro ? (
                  <Tombol
                    varian="bahaya"
                    className="min-h-8 text-xs"
                    onClick={() => {
                      if (!confirm(`Hapus perangkat "${p.nama}"? Sesi WhatsApp-nya di gateway ikut dihapus.`)) return;
                      void fnHapus({ data: { id: p.id } }).then(muat, (e: Error) => toast.error(e.message));
                    }}
                  >
                    <Trash2 className="size-3" /> Hapus
                  </Tombol>
                ) : null}
              </div>
            </Kartu>
          ))}
          {data && !data.perangkat.length ? (
            <Kartu className="text-sm text-redup">{wspro ? "Belum ada perangkat WSPRO yang tersambung." : "Belum ada perangkat pengecek."}</Kartu>
          ) : null}
        </div>

        <div className="space-y-4">
          {wspro ? (
            <Kartu>
              <h2 className="mb-1 font-semibold">Perangkat WSPRO</h2>
              <p className="text-sm text-redup">
                {angka(data?.perangkat.length ?? 0)} tersambung · {angka(aktifCount)} dipakai sebagai reader
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Tombol varian="utama" className="text-xs" disabled={segarSibuk} onClick={() => void segarkan()}>
                  <RotateCcw className={`size-3 ${segarSibuk ? "animate-spin" : ""}`} /> {segarSibuk ? "Menyegarkan…" : "Refresh"}
                </Tombol>
                <Tombol
                  className="text-xs"
                  onClick={() => {
                    if (!confirm("Lepaskan SEMUA perangkat reader ke posisi nonaktif sementara?")) return;
                    void fnSemua({ data: { aktif: false } }).then(muat, (e: Error) => toast.error(e.message));
                  }}
                >
                  Lepaskan semua
                </Tombol>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoSegar}
                  onChange={(e) => {
                    setAutoSegar(e.target.checked);
                    try {
                      localStorage.setItem("aawq_auto_segar", e.target.checked ? "1" : "0");
                    } catch {
                      /* abaikan */
                    }
                  }}
                />
                Auto-refresh tiap 30 detik {autoSegar ? <span className="text-siap">· aktif</span> : null}
              </label>
              <p className="mt-2 text-xs text-redup">
                Refresh: buang perangkat yang terputus atau dibatasi WhatsApp, lalu aktifkan semua yang baru tersambung sebagai reader (jumlah berubah dinamis). Auto-refresh menjalankannya otomatis saat halaman ini terbuka, jadi tak perlu klik manual. Lepaskan semua: nonaktifkan semua reader sementara.
              </p>
            </Kartu>
          ) : (
            <Kartu>
              <h2 className="mb-2 font-semibold">Tambah perangkat</h2>
              <input value={nama} onChange={(e) => setNama(e.target.value)} maxLength={60} placeholder="Nama, mis. Pengecek 1" className="w-full rounded-md border border-garis bg-panel-2 px-3 py-2 text-sm" />
              <Tombol varian="utama" className="mt-3 w-full" disabled={!data?.gateway} onClick={() => void tambah()}>
                <Plus className="size-4" /> Tambah dan pasangkan
              </Tombol>
            </Kartu>
          )}
          {data ? <FormAturan aturan={data.aturan} onSimpan={muat} /> : null}
        </div>
      </div>

      {pasang ? <Pemasangan id={pasang} tutup={() => (setPasang(null), muat())} /> : null}
    </Kerangka>
  );
}

function Pemasangan({ id, tutup }: { id: string; tutup: () => void }) {
  const fnStatus = useServerFn(statusPemasangan);
  const fnKode = useServerFn(kodePairing);
  const [st, setSt] = useState<{ status: string; nomor: string | null; qr: string | null } | null>(null);
  const [nomor, setNomor] = useState("");
  const [kode, setKode] = useState<string | null>(null);

  useEffect(() => {
    let hidup = true;
    const muat = () =>
      fnStatus({ data: { id } })
        .then((s) => hidup && setSt(s))
        .catch((e: Error) => hidup && toast.error(e.message));
    void muat();
    const t = setInterval(muat, 3000);
    return () => {
      hidup = false;
      clearInterval(t);
    };
  }, [fnStatus, id]);

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Pasangkan perangkat">
      <Kartu className="w-full max-w-sm">
        <h2 className="mb-3 font-semibold">Pasangkan perangkat pengecek</h2>
        {st?.status === "WORKING" ? (
          <p className="text-siap">Tersambung{st.nomor ? ` sebagai +${st.nomor}` : ""}. Perangkat siap dipakai.</p>
        ) : (
          <>
            <p className="text-sm text-redup">WhatsApp di HP pengecek: Perangkat tertaut &gt; Tautkan perangkat, lalu pindai QR ini.</p>
            <div className="my-3 flex min-h-56 items-center justify-center rounded-md bg-white p-3">
              {st?.qr ? <QRCodeSVG value={st.qr} size={208} /> : <span className="text-sm text-gray-500">{st ? `Menunggu QR (${st.status})…` : "Memuat…"}</span>}
            </div>
            <p className="text-sm text-redup">Atau pakai kode: masukkan nomor pengecek.</p>
            <div className="mt-2 flex gap-2">
              <input value={nomor} onChange={(e) => setNomor(e.target.value)} placeholder="+62 812…" className="min-w-0 flex-1 rounded-md border border-garis bg-panel-2 px-3 py-2 text-sm" />
              <Tombol onClick={() => void fnKode({ data: { id, nomor } }).then((r) => setKode(r.code), (e: Error) => toast.error(e.message))}>Minta kode</Tombol>
            </div>
            {kode ? <p className="mt-3 text-center font-mono text-2xl tracking-widest text-aksen">{kode}</p> : null}
          </>
        )}
        <Tombol className="mt-4 w-full" onClick={tutup}>
          Tutup
        </Tombol>
      </Kartu>
    </div>
  );
}

function FormAturan({ aturan, onSimpan }: { aturan: Data["aturan"]; onSimpan: () => void }) {
  const fnSimpan = useServerFn(simpanAturan);
  const [f, setF] = useState(aturan);
  type KunciAngka = "ukuran_kelompok" | "jeda_min_detik" | "jeda_maks_detik" | "batas_harian" | "umur_cache_hari" | "ambang_ragu" | "ambang_buang";
  const angkaKolom = (k: KunciAngka, label: string, bantu: string) => (
    <label key={k} className="block text-sm text-redup">
      {label} <span className="text-xs">({bantu})</span>
      <input type="number" value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-garis bg-panel-2 px-3 py-1.5 text-teks" />
    </label>
  );
  const centang = (k: "cek_aktivitas" | "cek_foto" | "cek_bisnis", label: string) => (
    <label key={k} className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <Kartu>
      <h2 className="mb-2 font-semibold">Laju pengecekan</h2>
      <div className="space-y-2">
        {angkaKolom("ukuran_kelompok", "Nomor per kueri", "1-50")}
        {angkaKolom("jeda_min_detik", "Jeda minimum (detik)", "per perangkat")}
        {angkaKolom("jeda_maks_detik", "Jeda maksimum (detik)", "acak di antara min-maks")}
        {angkaKolom("batas_harian", "Batas harian per perangkat", "0 = tanpa batas")}
        {angkaKolom("umur_cache_hari", "Pakai hasil cek lama (hari)", "nomor tidak dicek ulang")}
      </div>
      <p className="mt-2 text-xs text-redup">Bawaan hati-hati: 20 nomor per 8-15 detik (~6.000/jam) dan 15.000/hari per perangkat.</p>

      <h2 className="mt-5 mb-2 font-semibold">Skor aktif</h2>
      <div className="space-y-2">
        {centang("cek_aktivitas", "Nilai aktivitas akun yang terdaftar")}
        {centang("cek_foto", "Ikut cek foto profil (per nomor, lebih lambat)")}
        {centang("cek_bisnis", "Ikut cek akun bisnis")}
        {angkaKolom("ambang_ragu", "Ambang Ragu", "skor di bawah ini = Aktivitas rendah")}
        {angkaKolom("ambang_buang", "Ambang Buang", "skor di bawah ini = Kemungkinan tidak aktif; 0 = tidak pernah dibuang")}
        <label className="block text-sm text-redup">
          Akun bisnis
          <select value={f.bisnis} onChange={(e) => setF({ ...f, bisnis: e.target.value as "ragu" | "biarkan" })} className="mt-1 w-full rounded-md border border-garis bg-panel-2 px-3 py-1.5 text-teks">
            <option value="ragu">Tandai Ragu (bukan akun pribadi)</option>
            <option value="biarkan">Biarkan</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-redup">
        Skor = rata-rata berbobot sinyal yang terbaca: perangkat terakhir berubah (x3), About (x2), foto (x2), perangkat tertaut, pesan sementara. Sinyal yang disembunyikan pemilik
        tidak dihitung.
      </p>
      <Tombol className="mt-3 w-full" onClick={() => void fnSimpan({ data: f }).then(() => (toast.success("Tersimpan"), onSimpan()), (e: Error) => toast.error(e.message))}>
        Simpan
      </Tombol>
    </Kartu>
  );
}
