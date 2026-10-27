import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALASAN, type KodeAlasan } from "./kualitas";

// Skor ulang tingkat daftar dihitung di database (aawq_bobot/aawq_kategori). Tes ini menjaga bobot dan kategori
// di migrasi tetap sama dengan mesin kualitas.
const sql = readFileSync(new URL("../../db/migrations/001_awal.sql", import.meta.url), "utf8");

describe("bobot SQL selaras dengan ALASAN", () => {
  const bobotSql = Object.fromEntries([...sql.matchAll(/when '([a-z_]+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
  const buangSql = sql.match(/p_alasan && array\[([^\]]+)\] then 'buang'/)?.[1]?.match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];

  it("setiap alasan punya bobot yang sama", () => {
    for (const [kode, info] of Object.entries(ALASAN)) expect(bobotSql[kode], kode).toBe(info.bobot);
    expect(Object.keys(bobotSql).sort()).toEqual(Object.keys(ALASAN).sort());
  });

  it("alasan kategori buang sama", () => {
    const buangTs = (Object.keys(ALASAN) as KodeAlasan[]).filter((k) => ALASAN[k].kategori === "buang");
    expect([...buangSql].sort()).toEqual(buangTs.sort());
  });
});
