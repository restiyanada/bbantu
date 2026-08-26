import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatIDR(value: string | number): string {
  return `Rp ${Number(value).toLocaleString("id-ID")}`;
}
