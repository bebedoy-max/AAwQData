import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...k: ClassValue[]) => twMerge(clsx(k));
