import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALASAN, type KodeAlasan } from "./kualitas";

// Skor ulang tingkat daftar dihitung di database (aawq_bobot/aawq_kategori). Tes ini menjaga bobot dan kategori
// di migrasi tetap sama dengan mesin kualitas.
// Definisi TERBARU di antara semua migrasi (create or replace berikutnya menimpa yang lama).
const folder = new URL("../../db/migrations/", import.meta.url);
const semua = readdirSync(folder).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, folder), "utf8")).join("\n");
const terakhir = (nama: string) => semua.split(`create or replace function public.${nama}(`).at(-1) ?? "";
const sql = `${terakhir("aawq_bobot").split("$$")[1] ?? ""}${terakhir("aawq_kategori").split("$$")[1] ?? ""}`;

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
