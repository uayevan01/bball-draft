import Link from "next/link";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">NBA Draft App</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
          Draft head-to-head teams with custom rules.
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-zinc-600 dark:text-zinc-300">
          Create draft types, spin constraints (year/team), draft via live lobby, and track your history + NBA 2K
          results.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200">
                Sign in
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center justify-center rounded-full bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              Go to dashboard
            </Link>
          </SignedIn>
          <a
            href="http://localhost:8000/api/health"
            className="inline-flex h-11 items-center justify-center rounded-full border border-black/10 px-5 text-sm font-semibold hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
          >
            Backend health
          </a>
        </div>
      </main>
    </div>
  );
}
