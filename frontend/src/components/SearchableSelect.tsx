"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableSelectItemKey = string | number;

export type SearchableSelectProps<T> = {
  items: T[];
  value: SearchableSelectItemKey | null;
  onChange: (next: T | null) => void;

  getKey: (item: T) => SearchableSelectItemKey;
  getLabel: (item: T) => string;

  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
};

export function SearchableSelect<T>(props: SearchableSelectProps<T>) {
  const {
    items,
    value,
    onChange,
    getKey,
    getLabel,
    placeholder = "Select…",
    searchPlaceholder = "Search…",
    emptyText = "No matches",
    disabled = false,
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedItem = useMemo(() => {
    if (value == null) return null;
    return items.find((it) => getKey(it) === value) ?? null;
  }, [items, value, getKey]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => getLabel(it).toLowerCase().includes(q));
  }, [items, query, getLabel]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function selectItem(item: T) {
    onChange(item);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  function openDropdown() {
    if (disabled || items.length === 0) return;
    setOpen(true);
    setActiveIndex(0);
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        disabled={disabled || items.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-3 text-sm disabled:opacity-60 dark:border-white/10 dark:bg-black"
      >
        <span className={selectedItem ? "truncate" : "truncate text-zinc-500 dark:text-zinc-400"}>
          {items.length === 0 ? "No options" : selectedItem ? getLabel(selectedItem) : placeholder}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">▾</span>
      </button>

      {open ? (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-black">
          <div className="p-2">
            <input
              ref={inputRef}
              className="h-10 w-full rounded-lg border border-black/10 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-400/40 dark:border-white/10 dark:bg-black"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              placeholder={searchPlaceholder}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, Math.max(filteredItems.length - 1, 0)));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const it = filteredItems[activeIndex];
                  if (it) selectItem(it);
                }
              }}
            />
          </div>

          <div role="listbox" className="max-h-72 overflow-auto p-1">
            {filteredItems.length === 0 ? (
              <div className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">{emptyText}</div>
            ) : (
              filteredItems.map((it, idx) => {
                const active = idx === activeIndex;
                const selected = value != null && getKey(it) === value;
                return (
                  <button
                    key={String(getKey(it))}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => selectItem(it)}
                    className={[
                      "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm",
                      active ? "bg-zinc-100 dark:bg-white/10" : "hover:bg-zinc-50 dark:hover:bg-white/5",
                    ].join(" ")}
                  >
                    <span className="truncate">{getLabel(it)}</span>
                    {selected ? <span className="text-zinc-500 dark:text-zinc-400">✓</span> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}


