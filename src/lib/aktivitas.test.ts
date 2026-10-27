import { describe, expect, it } from "vitest";
import { ATURAN_AKTIF_BAWAAN, nilaiAktivitas, type SinyalWa } from "./aktivitas";

const sekarang = new Date("2026-10-27T00:00:00Z");
const lalu = (hari: number) => new Date(sekarang.getTime() - hari * 86_400_000).toISOString();
const kosong: SinyalWa = { perangkat: 1, tertaut: 0, hosted: false, kunciTs: null, about: null, hilangTs: null, business: false, picture: null };
const nilai = (s: Partial<SinyalWa>) => nilaiAktivitas({ ...kosong, ...s }, ATURAN_AKTIF_BAWAAN, sekarang);

describe("skor aktif", () => {
  it("akun jelas aktif: perangkat baru berubah, About ditulis baru, ada foto, tertaut Web", () => {
    const h = nilai({ kunciTs: lalu(10), about: { status: "ada", teks: "Kerja keras 💪", ts: lalu(20) }, picture: "ada", tertaut: 1 });
    expect(h.skor).toBeGreaterThanOrEqual(90);
    expect(h.alasan).toEqual([]);
  });

  it("sinyal yang disembunyikan tidak dihitung, bukan dianggap buruk", () => {
    const h = nilai({ kunciTs: lalu(40), about: { status: "tersembunyi", teks: null, ts: null }, picture: "tersembunyi" });
    expect(h.skor).toBe(90);
    expect(h.poin.find((p) => p.kode === "about")?.poin).toBeNull();
    expect(h.alasan).toEqual([]);
  });

  it("kemungkinan terbengkalai: perangkat tidak berubah 4 tahun, About bawaan lama, tanpa foto", () => {
    const h = nilai({ kunciTs: lalu(1500), about: { status: "ada", teks: "Hey there! I am using WhatsApp.", ts: lalu(2000) }, picture: "tidak_ada" });
    // (3*30 + 2*20 + 2*30) / 7 = 27
    expect(h.skor).toBe(27);
    expect(h.alasan).toEqual(["aktivitas_rendah"]);
  });

  it("di bawah ambang buang -> kemungkinan tidak aktif", () => {
    const h = nilaiAktivitas({ ...kosong, kunciTs: lalu(1500), picture: "tidak_ada" }, { ...ATURAN_AKTIF_BAWAAN, ambang_buang: 31 }, sekarang);
    expect(h.skor).toBe(30);
    expect(h.alasan).toEqual(["kemungkinan_tidak_aktif"]);
  });

  it("tanpa sinyal terbaca: skor null, tanpa vonis", () => {
    expect(nilai({})).toMatchObject({ skor: null, alasan: [] });
  });

  it("akun bisnis/hosted ditandai sesuai aturan", () => {
    expect(nilai({ kunciTs: lalu(10), business: true }).alasan).toEqual(["akun_bisnis"]);
    expect(nilai({ kunciTs: lalu(10), hosted: true }).alasan).toEqual(["akun_bisnis"]);
    expect(nilaiAktivitas({ ...kosong, kunciTs: lalu(10), business: true }, { ...ATURAN_AKTIF_BAWAAN, bisnis: "biarkan" }, sekarang).alasan).toEqual([]);
  });

  it("keterangan mudah dibaca", () => {
    const h = nilai({ kunciTs: lalu(400), tertaut: 2, hilangTs: lalu(30) });
    expect(h.poin.find((p) => p.kode === "perangkat_berubah")?.keterangan).toBe("13 bulan lalu");
    expect(h.poin.find((p) => p.kode === "tertaut")?.keterangan).toBe("2 perangkat (Web/Desktop)");
    expect(h.poin.find((p) => p.kode === "pesan_sementara")?.poin).toBe(100);
  });
});
