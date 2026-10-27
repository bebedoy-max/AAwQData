import { getCountries, getCountryCallingCode } from "libphonenumber-js";

const nama = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["id"], { type: "region" }) : null;

export const namaNegara = (kode: string) => {
  try {
    return nama?.of(kode) ?? kode;
  } catch {
    return kode;
  }
};

/** Semua negara yang dikenali libphonenumber, urut nama Indonesia; negara blast yang umum di atas. */
const UTAMA = ["ID", "BR", "HK", "MY", "SG", "PH", "TH", "VN", "IN", "US", "MX", "NG"];

export const DAFTAR_NEGARA = getCountries()
  .map((kode) => ({ kode, nama: namaNegara(kode), kodeTelepon: getCountryCallingCode(kode) }))
  .sort((a, b) => {
    const ia = UTAMA.indexOf(a.kode);
    const ib = UTAMA.indexOf(b.kode);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.nama.localeCompare(b.nama, "id");
  });
