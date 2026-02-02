"use client";

export function DraftLobbyHeader({
  draftName,
  canRename,
  isEditing,
  draftNameInput,
  onChangeDraftNameInput,
  onStartEdit,
  onCancelEdit,
  onSaveDraftName,
  showInvite,
  copied,
  onCopyDraftId,
  showHostSettingsButton,
  onOpenHostSettings,
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
  showInvite: boolean;
  copied: boolean;
  draftId: string;
  onCopyDraftId: () => void;
  showHostSettingsButton?: boolean;
  onOpenHostSettings?: () => void;
  showStartDraft: boolean;
  startDraftDisabled: boolean;
  onStartDraft: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
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
              <div className="text-2xl font-semibold text-zinc-950 dark:text-white">{draftName || "Draft"}</div>
              {canRename ? (
                <button type="button" onClick={onStartEdit} className="text-2xl text-zinc-600 hover:underline dark:text-zinc-300 -scale-x-100">
                  ✎
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {showInvite ? (
          <button
            type="button"
            onClick={onCopyDraftId}
            className="inline-flex h-10 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          >
            {copied ? "Copied!" : "Copy draft ID"}
          </button>
        ) : null}

        {showHostSettingsButton && onOpenHostSettings ? (
          <button
            type="button"
            onClick={onOpenHostSettings}
            className="inline-flex h-10 items-center justify-center rounded-full border border-black/10 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-black/5 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
          >
            Host settings
          </button>
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


