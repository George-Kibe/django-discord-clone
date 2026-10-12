"use client";

import { useSyncExternalStore } from "react";

import type { PresenceStatus } from "@/lib/realtime/events";

type Entry = { status: PresenceStatus; version: number };

/**
 * Live presence from gateway events, layered over the member list the API returned. Events win
 * over fetched data (a fetch may have started before the event), and a lower version never
 * overwrites a higher one (events from two tabs of the same user can arrive out of order).
 * Cleared on reconnect, when the member lists are refetched.
 */
export class PresenceStore {
  private entries = new Map<string, Entry>();
  private snapshot: ReadonlyMap<string, Entry> = new Map();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getSnapshot = (): ReadonlyMap<string, Entry> => this.snapshot;

  update(userId: string, status: PresenceStatus, version: number): void {
    const current = this.entries.get(userId);
    if (current && current.version >= version) return;
    this.entries.set(userId, { status, version });
    this.emit();
  }

  clear(): void {
    this.entries.clear();
    this.emit();
  }

  private emit(): void {
    this.snapshot = new Map(this.entries);
    for (const listener of this.listeners) listener();
  }
}

export const presenceStore = new PresenceStore();
const EMPTY: ReadonlyMap<string, Entry> = new Map();

/** userId → live status (only users we've had an event about). */
export function useLivePresence(): ReadonlyMap<string, Entry> {
  return useSyncExternalStore(presenceStore.subscribe, presenceStore.getSnapshot, () => EMPTY);
}
