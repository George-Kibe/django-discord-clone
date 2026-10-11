import { Perm, type PermName } from "@/types/permissions";

export { Perm };
export type { PermName };

/** True if the bitfield grants `perm` (ADMINISTRATOR implies everything). */
export function hasPerm(bits: number | undefined | null, perm: PermName): boolean {
  if (!bits) return false;
  if (bits & Perm.ADMINISTRATOR) return true;
  return (bits & Perm[perm]) !== 0;
}

export function toggleBit(bits: number, perm: PermName, on: boolean): number {
  return on ? bits | Perm[perm] : bits & ~Perm[perm];
}
