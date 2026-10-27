import { describe, expect, it } from "vitest";
import { cekNomor, nilai, polaBerulang, polaUrut } from "./kualitas";

const HK = { negaraTarget: ["HK" as const] };
const ID = { negaraTarget: ["ID" as const] };
const BR = { negaraTarget: ["BR" as const] };

describe("cekNomor: format", () => {
  it("menerima berbagai penulisan nomor seluler negara target", () => {
    for (const n of ["+852 9187 3264", "85291873264", "00852-9187-3264", "(852) 9187 3264"]) {
      const h = cekNomor(n, HK);
      expect(h.e164, n).toBe("85291873264");
      expect(h.kategori, n).toBe("siap");
      expect(h.skor).toBe(100);
    }
  });

  it("nomor lokal berawalan 0 memakai negara target", () => {
    expect(cekNomor("0812-3456-7890", ID)).toMatchObject({ e164: "6281234567890", negara: "ID", kategori: "siap" });
    expect(cekNomor("81234567890", ID).e164).toBe("6281234567890");
  });

  it("kosong, teks, dan nomor tidak valid dibuang", () => {
    expect(cekNomor("", ID).alasan).toEqual(["kosong"]);
    expect(cekNomor("   ", ID).alasan).toEqual(["kosong"]);
    expect(cekNomor("budi@contoh.com", ID).alasan).toEqual(["bukan_nomor"]);
    expect(cekNomor("12345", ID).alasan).toEqual(["bukan_nomor"]);
    const h = cekNomor("+852 1234", HK);
    expect(h.kategori).toBe("buang");
  });
});

describe("cekNomor: negara", () => {
  it("nomor valid negara lain dibuang", () => {
    const h = cekNomor("+6281234567890", HK);
    expect(h.alasan).toContain("negara_lain");
    expect(h.kategori).toBe("buang");
    expect(h.negara).toBe("ID");
  });

  it("nomor lokal Hong Kong yang salah diberi awalan 62 dikoreksi", () => {
    const h = cekNomor("6291873264", HK);
    expect(h.e164).toBe("85291873264");
    expect(h.koreksiDari).toBe("6291873264");
    expect(h.alasan).toEqual(["kode_negara_dikoreksi"]);
    expect(h.kategori).toBe("ragu");
  });

  it("koreksi bisa dimatikan", () => {
    const h = cekNomor("6291873264", { ...HK, koreksiKodeNegara: false });
    expect(h.kategori).toBe("buang");
    expect(h.koreksiDari).toBeNull();
  });

  it("nomor Indonesia asli di daftar Hong Kong tidak dikoreksi paksa", () => {
    const h = cekNomor("6281234567890", HK);
    expect(h.alasan).toContain("negara_lain");
    expect(h.koreksiDari).toBeNull();
  });

  it("tanpa negara target semua negara diterima", () => {
    expect(cekNomor("+5511973412856", { negaraTarget: [] }).kategori).toBe("siap");
  });
});

describe("cekNomor: tipe dan pola", () => {
  it("telepon rumah dan nomor khusus dibuang", () => {
    expect(cekNomor("+55 11 3234-5678", BR).alasan).toContain("telepon_rumah");
    expect(cekNomor("+1 800 555 1234", { negaraTarget: ["US"] }).alasan).toContain("nomor_khusus");
  });

  it("seluler Brasil siap", () => {
    expect(cekNomor("+55 11 97341-2856", BR)).toMatchObject({ e164: "5511973412856", kategori: "siap" });
  });

  it("pola berulang dan urut membuat ragu", () => {
    expect(polaBerulang("81200000000")).toBe(true);
    expect(polaBerulang("8123456789")).toBe(false);
    expect(polaUrut("8121234567")).toBe(true);
    expect(polaUrut("8127654321")).toBe(true);
    expect(polaUrut("8129182736")).toBe(false);
    const h = cekNomor("+6281200000000", ID);
    expect(h.alasan).toContain("pola_berulang");
    expect(h.kategori).toBe("ragu");
  });
});

describe("nilai", () => {
  it("alasan buang menang, skor tidak negatif, alasan ganda dihitung sekali", () => {
    expect(nilai([])).toEqual({ skor: 100, kategori: "siap" });
    expect(nilai(["pola_urut"])).toEqual({ skor: 60, kategori: "ragu" });
    expect(nilai(["pola_urut", "pola_urut"])).toEqual({ skor: 60, kategori: "ragu" });
    expect(nilai(["duplikat", "pola_urut"])).toEqual({ skor: 0, kategori: "buang" });
  });
});

describe("kinerja", () => {
  it("100.000 nomor diperiksa dalam waktu wajar", () => {
    const t0 = performance.now();
    for (let i = 0; i < 100_000; i++) cekNomor(`+55119${String(10000000 + i * 7).slice(-8)}`, BR);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(20_000);
  });
});
