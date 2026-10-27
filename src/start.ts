import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { lampirkanToken } from "./lib/auth";

// Mendefinisikan start.ts mematikan CSRF bawaan; dipasang lagi agar fungsi server terlindung dari situs lain.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

// Pekerja latar cek WhatsApp menyala pada permintaan pertama setelah server hidup (dan setelah restart):
// daftar yang masih "berjalan" otomatis dilanjutkan tanpa menunggu pengguna membuka halamannya.
const pekerja = createMiddleware().server(async ({ next }) => {
  (await import("./lib/cek-wa.server")).pastikanPekerjaCekWa();
  return next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [lampirkanToken],
  requestMiddleware: [pekerja, csrf],
}));
