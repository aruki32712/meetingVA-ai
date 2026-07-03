import Link from "next/link";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
      <header className="flex items-center justify-between border-b border-slate-200 pb-5">
        <div>
          <p className="text-sm font-medium text-meadow">MeetingVA AI</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-ink">
            Full-stack scaffold is online
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink"
            href="/login"
          >
            Sign in
          </Link>
          <Link
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white"
            href="/signup"
          >
            Sign up
          </Link>
        </div>
      </header>

      <section className="grid flex-1 gap-4 py-8 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Frontend</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Next.js 15 App Router with TypeScript and Tailwind CSS.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Backend</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            FastAPI service with a health endpoint at{" "}
            <code className="rounded bg-mist px-1.5 py-0.5">/health</code>.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Supabase</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Auth, PostgreSQL schema, and Storage-ready attachment records.
          </p>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-5 text-sm text-slate-600">
        Backend API target:{" "}
        <code className="rounded bg-mist px-1.5 py-0.5">{API_BASE_URL}</code>
        <span className="mx-2 text-slate-300">|</span>
        <a className="text-signal hover:text-ink" href="/api/health">
          Frontend health
        </a>
      </footer>
    </main>
  );
}
