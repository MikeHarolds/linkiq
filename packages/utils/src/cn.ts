import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind class names safely, resolving conflicting utility
 * classes (e.g. `p-2` vs `p-4`). Used by every UI component.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
