import Link from "next/link";
import { UserButton } from "@clerk/nextjs";

export function AppShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <header className="border-b border-black/10 dark:border-white/10 dark:bg-zinc-950/60">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-semibold tracking-tight">
              BBall Draft
            </Link>
            <nav className="flex items-center gap-3 text-sm text-zinc-600 dark:text-zinc-300">
              <Link href="/dashboard" className="hover:text-zinc-950 dark:hover:text-white">
                Dashboard
              </Link>
              <Link href="/draft/new" className="hover:text-zinc-950 dark:hover:text-white">
                New draft
              </Link>
              <Link href="/draft-types" className="hover:text-zinc-950 dark:hover:text-white">
                Draft types
              </Link>
              <Link href="/history" className="hover:text-zinc-950 dark:hover:text-white">
                History
              </Link>
              <Link href="/games" className="hover:text-zinc-950 dark:hover:text-white">
                Games
              </Link>
            </nav>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      </header>
      <main className={`mx-auto px-6 py-8 ${wide ? "max-w-none" : "max-w-5xl"}`}>{children}</main>
    </div>
  );
}


