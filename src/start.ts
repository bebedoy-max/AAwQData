import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { lampirkanToken } from "./lib/auth";

// Mendefinisikan start.ts mematikan CSRF bawaan; dipasang lagi agar fungsi server terlindung dari situs lain.
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

export const startInstance = createStart(() => ({
  functionMiddleware: [lampirkanToken],
  requestMiddleware: [csrf],
}));
