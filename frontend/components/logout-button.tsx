"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";

export function LogoutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    setIsSigningOut(true);
    setError("");

    const supabase = createBrowserSupabaseClient();
    const { error: signOutError } = await supabase.auth.signOut();

    setIsSigningOut(false);

    if (signOutError) {
      setError(signOutError.message);
      return;
    }

    router.replace("/login");
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-ink disabled:cursor-not-allowed disabled:text-slate-400"
        type="button"
        onClick={handleLogout}
        disabled={isSigningOut}
      >
        {isSigningOut ? "Signing out..." : "Log out"}
      </button>
      {error ? <p className="text-right text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
