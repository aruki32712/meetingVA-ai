"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";

const features = [
  {
    title: "Record every conversation",
    description:
      "Capture meetings in one secure workspace so important context never gets lost.",
    icon: (
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3m-4 0h8" />
    )
  },
  {
    title: "AI transcription",
    description:
      "Turn spoken conversations into accurate, structured transcripts automatically.",
    icon: <path d="M4 6h16M4 10h16M4 14h10M4 18h7" />
  },
  {
    title: "Speaker identification",
    description:
      "Know exactly who said what with clear speaker labels throughout every transcript.",
    icon: (
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m-2-12a4 4 0 0 1 0 7.75" />
    )
  },
  {
    title: "Executive summaries",
    description:
      "Get concise, decision-ready summaries without replaying hours of recordings.",
    icon: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  },
  {
    title: "Action items",
    description:
      "Automatically surface next steps, owners, and commitments while they are fresh.",
    icon: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  },
  {
    title: "Searchable history",
    description:
      "Find any insight, decision, or discussion across your complete meeting history.",
    icon: <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
  }
];

export default function Home() {
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createBrowserSupabaseClient();

    async function checkSession() {
      const { data } = await supabase.auth.getSession();

      if (!isMounted) return;

      if (data.session) {
        router.replace("/dashboard");
        return;
      }

      setIsCheckingSession(false);
    }

    void checkSession();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) router.replace("/dashboard");
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  if (isCheckingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-signal"
          aria-label="Checking your session"
        />
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-hidden bg-white text-ink">
      <div className="relative">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_75%_15%,rgba(47,128,237,0.14),transparent_32%),radial-gradient(circle_at_15%_65%,rgba(31,138,112,0.1),transparent_28%)]" />

        <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6 lg:px-8">
          <Link className="flex items-center gap-3" href="/" aria-label="MeetingVA AI home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-white shadow-sm">
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                <path d="M6 12a6 6 0 0 0 12 0M12 18v3" />
              </svg>
            </span>
            <span className="text-lg font-semibold tracking-tight">
              MeetingVA <span className="text-signal">AI</span>
            </span>
          </Link>

          <nav className="flex items-center gap-3" aria-label="Account">
            <Link
              className="rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-ink"
              href="/login"
            >
              Sign In
            </Link>
            <Link
              className="rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
              href="/signup"
            >
              Create Account
            </Link>
          </nav>
        </header>

        <section className="mx-auto grid w-full max-w-7xl items-center gap-16 px-6 pb-24 pt-16 lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:pb-32 lg:pt-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-signal/20 bg-signal/5 px-3 py-1.5 text-sm font-medium text-signal">
              <span className="h-2 w-2 rounded-full bg-meadow" />
              Turn conversations into clarity
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
              AI-Powered Meeting Intelligence
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600">
              Record every meeting and let AI transcribe the conversation,
              identify speakers, create executive summaries, capture action
              items, and build a searchable history your team can rely on.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex items-center justify-center rounded-lg bg-signal px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-signal/20 transition hover:bg-blue-600"
                href="/signup"
              >
                Create Account
                <span className="ml-2" aria-hidden="true">→</span>
              </Link>
              <Link
                className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-ink shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
                href="/login"
              >
                Sign In
              </Link>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="absolute -inset-5 -z-10 rounded-[2rem] bg-gradient-to-br from-signal/15 to-meadow/10 blur-2xl" />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-900/10">
              <div className="flex items-center justify-between border-b border-slate-100 px-2 pb-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Latest meeting</p>
                  <p className="mt-1 font-semibold">Q3 Product Strategy</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-meadow">Analyzed</span>
              </div>
              <div className="mt-4 rounded-xl bg-slate-50 p-5">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-signal" />
                  Executive summary
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  The team aligned on the Q3 launch plan, prioritized the
                  onboarding experience, and confirmed the customer beta timeline.
                </p>
              </div>
              <div className="grid gap-3 pt-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-100 p-4">
                  <p className="text-2xl font-semibold text-ink">4</p>
                  <p className="mt-1 text-xs text-slate-500">Action items captured</p>
                </div>
                <div className="rounded-xl border border-slate-100 p-4">
                  <p className="text-2xl font-semibold text-ink">3</p>
                  <p className="mt-1 text-xs text-slate-500">Speakers identified</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="border-t border-slate-100 bg-slate-50/70">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-meadow">One intelligent workspace</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Everything after “join meeting,” handled.
            </h2>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <article
                className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                key={feature.title}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-signal/10 text-signal">
                  <svg
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {feature.icon}
                  </svg>
                </span>
                <h3 className="mt-5 font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-6 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <p className="font-semibold text-ink">MeetingVA AI</p>
          <p>Turn every meeting into momentum.</p>
        </div>
      </footer>
    </main>
  );
}
