import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ekspor/$tiket")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { ambilTiket, aliranCsv, aliranLaporan } = await import("@/lib/ekspor.server");
        const t = ambilTiket(params.tiket);
        if (!t) return new Response("Tautan unduhan kedaluwarsa. Tekan tombol unduh lagi.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
        const aman = t.nama.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "daftar";
        if (t.format === "laporan")
          return new Response(aliranLaporan(t), {
            headers: {
              "content-type": "text/plain; charset=utf-8",
              "content-disposition": `attachment; filename="${aman}_laporan_bio.txt"`,
              "cache-control": "no-store",
            },
          });
        return new Response(aliranCsv(t), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${aman}_${t.kategori}${t.format === "nomor" ? "_nomor" : ""}.csv"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
