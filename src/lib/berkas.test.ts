import { describe, expect, it } from "vitest";
import { dariTeks, jadikanTabel, tebakKolomNomor, uraiCsv } from "./berkas";

describe("uraiCsv", () => {
  it("koma, kutip, baris baru di dalam kutip, CRLF", () => {
    expect(uraiCsv('nama,nomor\r\n"Budi, S.",+62 812-3456-7890\r\n"baris\nbaru",0812\n')).toEqual([
      ["nama", "nomor"],
      ["Budi, S.", "+62 812-3456-7890"],
      ["baris\nbaru", "0812"],
    ]);
  });

  it("mendeteksi pemisah titik koma dan tab", () => {
    expect(uraiCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(uraiCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("BOM dan baris kosong diabaikan", () => {
    expect(uraiCsv("﻿nomor\n\n6281234567890\n")).toEqual([["nomor"], ["6281234567890"]]);
  });
});

describe("jadikanTabel + tebakKolomNomor", () => {
  it("baris judul dikenali dan kolom nomor dipilih", () => {
    const t = jadikanTabel(uraiCsv("nama,kota,whatsapp\nBudi,Jakarta,081234567890\nAni,Bandung,+62 813 9876 5432\n"));
    expect(t.adaJudul).toBe(true);
    expect(t.kolom).toEqual(["nama", "kota", "whatsapp"]);
    expect(t.baris).toHaveLength(2);
    expect(tebakKolomNomor(t)).toBe(2);
  });

  it("tanpa judul: semua baris adalah data", () => {
    const t = jadikanTabel(uraiCsv("081234567890\n081298765432\n"));
    expect(t.adaJudul).toBe(false);
    expect(t.baris).toHaveLength(2);
  });

  it("tempelan teks", () => {
    expect(dariTeks("0812 3456 7890\n+852 9187 3264, 6281200000000").baris).toEqual([["0812 3456 7890"], ["+852 9187 3264"], ["6281200000000"]]);
  });
});
