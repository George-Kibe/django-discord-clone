import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * False during server rendering and the first client paint, true once React has hydrated.
 * Submit buttons wait for it so a click can't fall through to a native form submission.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
