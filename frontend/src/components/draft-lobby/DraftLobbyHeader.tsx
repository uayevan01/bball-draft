"use client";

import Link from "next/link";

export function DraftLobbyHeader({
  draftName,
  canRename,
  isEditing,
  draftNameInput,
  onChangeDraftNameInput,
  onStartEdit,
  onCancelEdit,
  onSaveDraftName,
  draftPathText,
  connectedText,
  currentTurnText,
  showInvite,
  copied,
  inviteUrl,
  onCopyInvite,
  showStartDraft,
  startDraftDisabled,
  onStartDraft,
}: {
  draftName: string | null;
  canRename: boolean;
  isEditing: boolean;
  draftNameInput: string;
  onChangeDraftNameInput: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveDraftName: () => void;
  draftPathText: string;
  connectedText: string;
  currentTurnText: string;
  showInvite: boolean;
  copied: boolean;
  inviteUrl: string;
  onCopyInvite: () => void;
  showStartDraft: boolean;
  startDraftDisabled: boolean;
  onStartDraft: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <input
                value={draftNameInput}
                onChange={(e) => onChangeDraftNameInput(e.target.value)}
                className="h-9 w-[220px] rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
                placeholder="Draft name…"
              />
              <button
                type="button"
                onClick={onSaveDraftName}
                className="h-9 rounded-full bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                Save
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="h-9 rounded-full border border-black/10 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-zinc-950 dark:text-white">{draftName || "Draft"}</div>
              {canRename ? (
                <button type="button" onClick={onStartEdit} className="text-xs text-zinc-600 hover:underline dark:text-zinc-300">
                  Rename
                </button>
              ) : null}
            </>
          )}
        </div>
        <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{draftPathText}</div>
        <div className="text-zinc-600 dark:text-zinc-300">{connectedText}</div>
        <div className="text-zinc-600 dark:text-zinc-300">{currentTurnText}</div>
      </div>

      <div className="flex items-center gap-3">
        {showInvite ? (
          <>
            <button
              type="button"
              onClick={onCopyInvite}
              className="inline-flex h-10 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
            >
              {copied ? "Copied!" : "Copy invite link"}
            </button>
            {inviteUrl ? (
              <input
                readOnly
                value={inviteUrl}
                className="hidden h-10 w-[360px] rounded-full border border-black/10 bg-white px-4 text-xs text-zinc-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200 md:block"
              />
            ) : null}
            <Link href="/history" className="hidden text-xs text-zinc-600 hover:underline dark:text-zinc-300 md:block">
              History
            </Link>
          </>
        ) : null}

        {showStartDraft ? (
          <button
            type="button"
            onClick={onStartDraft}
            disabled={startDraftDisabled}
            className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Start draft
          </button>
        ) : null}
      </div>
    </div>
  );
}


