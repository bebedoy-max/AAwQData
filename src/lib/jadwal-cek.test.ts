import { describe, expect, it } from "vitest";
import { ATURAN_BAWAAN, cekHariIni, hariWib, jedaBerikut, kesiapan, perkiraanDetik, teksDurasi } from "./jadwal-cek";

const sekarang = new Date("2026-10-27T10:00:00Z");
const siap = { aktif: true, status: "WORKING", ditahan_sampai: null, hari: hariWib(sekarang), cek_hari_ini: 0 };

describe("kesiapan perangkat", () => {
  it("siap bila aktif, tersambung, tidak ditahan, di bawah batas harian", () => {
    expect(kesiapan(siap, ATURAN_BAWAAN, sekarang)).toEqual({ siap: true, alasan: "Siap" });
  });
  it("tidak siap: nonaktif, ditahan, belum dipasangkan, terputus, batas harian", () => {
    expect(kesiapan({ ...siap, aktif: false }, ATURAN_BAWAAN, sekarang).siap).toBe(false);
    expect(kesiapan({ ...siap, ditahan_sampai: "2026-10-27T11:00:00Z" }, ATURAN_BAWAAN, sekarang).alasan).toMatch(/Ditahan/);
    expect(kesiapan({ ...siap, ditahan_sampai: "2026-10-27T09:00:00Z" }, ATURAN_BAWAAN, sekarang).siap).toBe(true);
    expect(kesiapan({ ...siap, status: "SCAN_QR_CODE" }, ATURAN_BAWAAN, sekarang).alasan).toBe("Belum dipasangkan");
    expect(kesiapan({ ...siap, status: "STOPPED" }, ATURAN_BAWAAN, sekarang).alasan).toBe("Tidak tersambung");
    expect(kesiapan({ ...siap, cek_hari_ini: 15000 }, ATURAN_BAWAAN, sekarang).alasan).toBe("Batas harian tercapai");
    expect(kesiapan({ ...siap, cek_hari_ini: 15000 }, { ...ATURAN_BAWAAN, batas_harian: 0 }, sekarang).siap).toBe(true);
  });
  it("hitungan harian direset di hari WIB berikutnya", () => {
    expect(hariWib(new Date("2026-10-27T16:59:00Z"))).toBe("2026-10-27");
    expect(hariWib(new Date("2026-10-27T17:00:00Z"))).toBe("2026-10-28");
    expect(cekHariIni({ hari: "2026-10-26", cek_hari_ini: 15000 }, sekarang)).toBe(0);
    expect(kesiapan({ ...siap, hari: "2026-10-26", cek_hari_ini: 15000 }, ATURAN_BAWAAN, sekarang).siap).toBe(true);
  });
});

describe("jeda dan perkiraan", () => {
  it("jeda acak di antara min dan maks, minimal 3 dtk", () => {
    expect(jedaBerikut(ATURAN_BAWAAN, () => 0)).toBe(8000);
    expect(jedaBerikut(ATURAN_BAWAAN, () => 1)).toBe(15000);
    expect(jedaBerikut({ ...ATURAN_BAWAAN, jeda_min_detik: 1, jeda_maks_detik: 1 }, () => 0.5)).toBe(3000);
    expect(jedaBerikut({ ...ATURAN_BAWAAN, jeda_min_detik: 20, jeda_maks_detik: 10 }, () => 0.5)).toBe(10000);
  });
  it("perkiraan lama memperhitungkan jumlah perangkat dan batas harian", () => {
    // 20 nomor per 11,5 dtk rata-rata = ~1,74 nomor/dtk per perangkat
    expect(perkiraanDetik(0, 1, ATURAN_BAWAAN)).toBe(0);
    expect(perkiraanDetik(100, 0, ATURAN_BAWAAN)).toBeNull();
    expect(perkiraanDetik(10_000, 1, ATURAN_BAWAAN)).toBe(5750);
    expect(perkiraanDetik(10_000, 2, ATURAN_BAWAAN)).toBe(2875);
    // 300.000 nomor, 5 perangkat x 15.000/hari = 75.000/hari -> 3 hari penuh + sisa
    expect(perkiraanDetik(300_000, 5, ATURAN_BAWAAN)).toBeGreaterThan(3 * 86_400);
    expect(teksDurasi(5750)).toBe("1,6 jam");
    expect(teksDurasi(null)).toBe("menunggu perangkat siap");
  });
});
