import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names safely, resolving conflicts.
 * Used by every UI component in the design system.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
