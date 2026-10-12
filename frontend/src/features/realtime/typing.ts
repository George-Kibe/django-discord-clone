"use client";

import { useSyncExternalStore } from "react";

export type Typer = { userId: string; name: string };

/**
 * Who is typing where. Entries expire after the server's `expires_in`, or as soon as that user's
 * message arrives. Kept outside React Query: it's ephemeral and changes many times per second.
 */
export class TypingStore {
  private byChannel = new Map<string, Typer[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  get(channelId: string): Typer[] {
    return this.byChannel.get(channelId) ?? EMPTY;
  }

  start(channelId: string, typer: Typer, seconds: number): void {
    const key = `${channelId}:${typer.userId}`;
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => this.stop(channelId, typer.userId), seconds * 1000),
    );
    const others = this.get(channelId).filter((t) => t.userId !== typer.userId);
    this.set(channelId, [...others, typer]);
  }

  stop(channelId: string, userId: string): void {
    const key = `${channelId}:${userId}`;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const current = this.get(channelId);
    if (current.some((t) => t.userId === userId))
      this.set(
        channelId,
        current.filter((t) => t.userId !== userId),
      );
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.byChannel.clear();
    this.emit();
  }

  private set(channelId: string, typers: Typer[]): void {
    if (typers.length) this.byChannel.set(channelId, typers);
    else this.byChannel.delete(channelId);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const EMPTY: Typer[] = [];

export const typingStore = new TypingStore();

export function useTypers(channelId: string): Typer[] {
  return useSyncExternalStore(
    typingStore.subscribe,
    () => typingStore.get(channelId),
    () => EMPTY,
  );
}

/** "Ana is typing…", "Ana and Bo are typing…", "Ana, Bo and Cy are typing…", "Several people…" */
export function typingText(typers: Typer[]): string {
  const names = typers.map((t) => t.name);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]} are typing…`;
  return "Several people are typing…";
}
