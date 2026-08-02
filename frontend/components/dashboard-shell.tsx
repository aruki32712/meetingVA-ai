"use client";

import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import { LogoutButton } from "./logout-button";
import { MEETING_DELETED_NOTICE } from "./meeting-deletion-state";

const navigationItems = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/meetings", label: "Meetings" },
  { href: "/dashboard/search", label: "Search" },
  { href: "/dashboard/progress", label: "Progress" }
];

function isActivePath(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const storedNotice = window.sessionStorage.getItem("meetingva:notice");

    if (storedNotice === MEETING_DELETED_NOTICE) {
      setNotice(storedNotice);
      window.sessionStorage.removeItem("meetingva:notice");
    }
  }, [pathname]);

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
      <header className="flex flex-col gap-5 border-b border-slate-200 pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-meadow">MeetingVA AI</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">
              Signed in as {user?.email ?? "authenticated user"}
            </p>
          </div>
          <LogoutButton />
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Dashboard navigation">
          {navigationItems.map((item) => {
            const isActive = isActivePath(pathname, item.href);

            return (
              <Link
                key={item.href}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-ink bg-ink text-white"
                    : "border-slate-300 bg-white text-ink hover:border-ink"
                }`}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 py-8">
        {notice ? (
          <div
            className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800"
            role="status"
          >
            {notice}
          </div>
        ) : null}
        {children}
      </div>
    </main>
  );
}
