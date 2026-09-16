"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` once it has stopped changing for `delayMs`.
 * Lets typed inputs stay responsive while the derived request only fires after typing settles.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);

  return debounced;
}
