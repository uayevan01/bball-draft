"use client";

import { useEffect, useRef } from "react";

/**
 * When it's the user's turn but the tab is hidden/unfocused, blink the document title.
 * Keeps behavior lightweight (no favicon generation) and works across browsers.
 */
export function useTurnTabIndicator(opts: { isMyTurn: boolean; enabled?: boolean; label?: string }) {
  const { isMyTurn, enabled = true, label = "Your turn" } = opts;

  const originalTitleRef = useRef<string | null>(null);
  const intervalRef = useRef<number | null>(null);
  const hasAttentionRef = useRef<boolean>(true);

  useEffect(() => {
    if (originalTitleRef.current == null && typeof document !== "undefined") {
      originalTitleRef.current = document.title;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const computeHasAttention = () => !document.hidden && document.hasFocus();
    const stopBlink = () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      const original = originalTitleRef.current ?? document.title;
      document.title = original;
    };
    const maybeStartBlink = () => {
      const original = originalTitleRef.current ?? document.title;
      const hasAttention = computeHasAttention();
      hasAttentionRef.current = hasAttention;
      if (!isMyTurn) return stopBlink();
      if (hasAttention) return stopBlink();
      if (intervalRef.current) return;

      let on = false;
      intervalRef.current = window.setInterval(() => {
        on = !on;
        document.title = `${on ? "●" : "◯"} ${label} — ${original}`;
      }, 900);
    };

    // Initial.
    maybeStartBlink();

    const onVisibility = () => maybeStartBlink();
    const onFocus = () => maybeStartBlink();
    const onBlur = () => maybeStartBlink();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      stopBlink();
    };
  }, [enabled, isMyTurn, label]);
}


