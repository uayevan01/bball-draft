import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export function AppShell({
  children,
  fitViewport,
}: {
  children: React.ReactNode;
  fitViewport?: boolean;
}) {
  return (
    <div
      className={`overflow-x-clip bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 ${
        fitViewport ? "flex min-h-screen flex-col lg:h-dvh lg:overflow-hidden" : "min-h-screen"
      }`}
    >
      <header className="shrink-0 border-b border-black/10 dark:border-white/10 dark:bg-zinc-950/60">
        <div className="mx-auto flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
            <Link href="/dashboard" className="shrink-0 font-semibold tracking-tight">
              BBall Draft
            </Link>
            <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 sm:text-sm dark:text-zinc-300">
              <Link href="/draft-types" className="hover:text-zinc-950 dark:hover:text-white">
                Draft Types
              </Link>
              <Link href="/players" className="hover:text-zinc-950 dark:hover:text-white">
                Player Database
              </Link>
              <Link href="/history" className="hover:text-zinc-950 dark:hover:text-white">
                History
              </Link>
              {/* <Link href="/games" className="hover:text-zinc-950 dark:hover:text-white">
                Games
              </Link> */}
            </nav>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>
      <main
        className={`mx-auto min-w-0 px-4 py-6 sm:px-6 sm:py-8 ${
          fitViewport ? "flex w-full flex-1 flex-col lg:min-h-0 lg:overflow-hidden" : ""
        }`}
      >
        {children}
      </main>
    </div>
  );
}
