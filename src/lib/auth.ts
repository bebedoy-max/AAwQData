import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { supabase } from "./supabase";

/** Dipasang global di src/start.ts: setiap panggilan fungsi server membawa token login pengguna. */
export const lampirkanToken = createMiddleware({ type: "function" }).client(async ({ next }) => {
  let { session } = (await supabase.auth.getSession()).data;
  // Tab HP yang lama di latar belakang sering membawa token kedaluwarsa: segarkan dulu.
  if (session && (session.expires_at ?? 0) * 1000 - Date.now() < 60_000) session = (await supabase.auth.refreshSession()).data.session;
  return next({ headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} });
});

/** Fungsi server yang butuh pengguna masuk: context.userId terisi, atau galat UNAUTHORIZED. */
export const wajibMasuk = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const header = getRequest()?.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const { penggunaDariToken } = await import("./supabase.server");
  const userId = await penggunaDariToken(token);
  return next({ context: { userId } });
});
