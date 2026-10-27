import { HeadContent, Link, Outlet, Scripts, createRootRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "AAwQData · Kualitas Nomor Target" },
      { name: "theme-color", content: "#0b1220" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: Shell,
  component: () => <Outlet />,
  notFoundComponent: () => (
    <Pesan judul="Halaman tidak ditemukan">
      <Link to="/" className="text-aksen underline">
        Kembali ke beranda
      </Link>
    </Pesan>
  ),
  errorComponent: Galat,
});

function Shell({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen">
        {children}
        <Toaster theme="dark" position="top-center" richColors />
        <Scripts />
      </body>
    </html>
  );
}

function Galat({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <Pesan judul="Terjadi galat">
      <p className="text-sm text-redup">{error instanceof Error ? error.message : String(error)}</p>
      <button
        type="button"
        className="mt-4 rounded-md bg-aksen px-4 py-2 text-sm font-semibold text-aksen-teks"
        onClick={() => {
          void router.invalidate();
          reset();
        }}
      >
        Coba lagi
      </button>
    </Pesan>
  );
}

function Pesan({ judul, children }: { judul: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">{judul}</h1>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
