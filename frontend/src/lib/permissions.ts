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

/** DM participants implicitly hold every message permission except moderation (DATA_MODEL.md). */
export const DM_PERMISSIONS =
  Object.values(Perm).reduce((all, bit) => all | bit, 0) &
  ~Perm.ADMINISTRATOR &
  ~Perm.MANAGE_MESSAGES;
