"use client";

import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { LogoutButton } from "./logout-button";

export function DashboardClient() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createBrowserSupabaseClient();

    async function loadSession() {
      const { data } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (!data.session) {
        router.replace("/login");
        return;
      }

      setUser(data.session.user);
      setIsLoading(false);
    }

    loadSession();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        router.replace("/login");
        return;
      }

      setUser(session.user);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  if (isLoading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Loading your dashboard...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-meadow">MeetingVA AI</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Signed in as {user?.email ?? "authenticated user"}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="grid gap-4 py-8 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Authentication</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Supabase Auth is connected with persistent browser sessions and
            protected route redirects.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Meetings</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Meeting workflows are intentionally not implemented yet.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-ink">Next Phase</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The next roadmap item is the full dashboard experience.
          </p>
        </div>
      </section>
    </main>
  );
}
