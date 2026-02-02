import { useEffect } from "react";

export function HostSettingsModal({
  open,
  onClose,
  canForceReroll,
  onForceReroll,
  canUndoPick,
  onUndoPick,
}: {
  open: boolean;
  onClose: () => void;
  canForceReroll: boolean;
  onForceReroll: () => void;
  canUndoPick: boolean;
  onUndoPick: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Host settings"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        aria-label="Close host settings"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg rounded-2xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-zinc-900">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-semibold text-zinc-950 dark:text-white">Host Settings</div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-950/40 dark:text-white dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-zinc-950/40 dark:text-zinc-100 dark:hover:bg-zinc-950/60"
            disabled={!canForceReroll}
            onClick={onForceReroll}
            title="Force a new roll for the current turn (host-only)"
          >
            Force reroll
          </button>

          <button
            type="button"
            className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/15"
            disabled={!canUndoPick}
            onClick={onUndoPick}
            title="Undo the most recent pick (host-only)"
          >
            Undo last pick
          </button>
        </div>
      </div>
    </div>
  );
}


