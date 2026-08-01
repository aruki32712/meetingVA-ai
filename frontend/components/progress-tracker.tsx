"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase";
import {
  buildProgressTrackerSeed,
  type SeededProgressStatus
} from "./progress-tracker-seed";

type PhaseStatus = SeededProgressStatus;

type ProgressPhaseRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  status: PhaseStatus;
  position: number;
  created_at: string;
  updated_at: string;
};

type ChecklistItemRow = {
  id: string;
  phase_id: string;
  label: string;
  is_complete: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

type ProgressPhase = ProgressPhaseRow & {
  checklistItems: ChecklistItemRow[];
};

const statusOptions: Array<{ value: PhaseStatus; label: string }> = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "complete", label: "Complete" }
];

function getStatusClasses(status: PhaseStatus) {
  switch (status) {
    case "complete":
      return "border-meadow bg-emerald-50 text-meadow";
    case "in_progress":
      return "border-signal bg-blue-50 text-signal";
    case "blocked":
      return "border-red-300 bg-red-50 text-red-700";
    case "not_started":
      return "border-slate-300 bg-slate-50 text-slate-600";
  }
}

function getCompletionPercentage(phases: ProgressPhase[]) {
  const items = phases.flatMap((phase) => phase.checklistItems);

  if (items.length === 0) {
    return 0;
  }

  const completed = items.filter((item) => item.is_complete).length;
  return Math.round((completed / items.length) * 100);
}

function sortProgressData(
  phases: ProgressPhaseRow[],
  items: ChecklistItemRow[]
): ProgressPhase[] {
  return phases
    .map((phase) => ({
      ...phase,
      checklistItems: items
        .filter((item) => item.phase_id === phase.id)
        .sort((a, b) => a.position - b.position)
    }))
    .sort((a, b) => a.position - b.position);
}

export function ProgressTracker() {
  const [phases, setPhases] = useState<ProgressPhase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingPhaseId, setSavingPhaseId] = useState("");
  const [savingItemId, setSavingItemId] = useState("");

  const completionPercentage = useMemo(
    () => getCompletionPercentage(phases),
    [phases]
  );

  const seedDefaultProgress = useCallback(async (userId: string) => {
    const supabase = createBrowserSupabaseClient();
    const defaultPhases = buildProgressTrackerSeed();
    const phaseRows = defaultPhases.map((phase, index) => ({
      owner_id: userId,
      title: phase.title,
      description: phase.description,
      status: phase.status,
      position: index + 1,
      created_at: phase.createdAt,
      updated_at: phase.createdAt
    }));

    const { data: insertedPhases, error: phaseError } = await supabase
      .from("project_progress_phases")
      .insert(phaseRows)
      .select("*");

    if (phaseError) {
      throw phaseError;
    }

    const insertedPhaseRows = insertedPhases as ProgressPhaseRow[];
    const checklistRows = insertedPhaseRows.flatMap((phase) => {
      const defaultPhase = defaultPhases.find(
        (item) => item.title === phase.title
      );

      return (defaultPhase?.checklistItems ?? []).map((item, index) => ({
        phase_id: phase.id,
        label: item.label,
        is_complete: item.isComplete,
        position: index + 1,
        created_at: phase.created_at,
        updated_at: phase.created_at
      }));
    });

    const { data: insertedItems, error: itemError } = await supabase
      .from("project_progress_checklist_items")
      .insert(checklistRows)
      .select("*");

    if (itemError) {
      throw itemError;
    }

    return sortProgressData(
      insertedPhaseRows,
      (insertedItems ?? []) as ChecklistItemRow[]
    );
  }, []);

  const loadProgress = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    const user = sessionData.session?.user;

    if (!user) {
      return [];
    }

    const { data: phaseData, error: phaseError } = await supabase
      .from("project_progress_phases")
      .select("*")
      .eq("owner_id", user.id)
      .order("position", { ascending: true });

    if (phaseError) {
      throw phaseError;
    }

    const phaseRows = (phaseData ?? []) as ProgressPhaseRow[];

    if (phaseRows.length === 0) {
      return seedDefaultProgress(user.id);
    }

    const phaseIds = phaseRows.map((phase) => phase.id);
    const { data: itemData, error: itemError } = await supabase
      .from("project_progress_checklist_items")
      .select("*")
      .in("phase_id", phaseIds)
      .order("position", { ascending: true });

    if (itemError) {
      throw itemError;
    }

    return sortProgressData(
      phaseRows,
      (itemData ?? []) as ChecklistItemRow[]
    );
  }, [seedDefaultProgress]);

  useEffect(() => {
    let isMounted = true;

    async function hydrateProgress() {
      setIsLoading(true);
      setError("");

      try {
        const loadedPhases = await loadProgress();

        if (isMounted) {
          setPhases(loadedPhases);
        }
      } catch (progressError) {
        if (isMounted) {
          setError(
            progressError instanceof Error
              ? progressError.message
              : "Unable to load progress tracker."
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    hydrateProgress();

    return () => {
      isMounted = false;
    };
  }, [loadProgress]);

  async function updatePhaseStatus(phaseId: string, status: PhaseStatus) {
    const previousPhases = phases;

    setSavingPhaseId(phaseId);
    setError("");
    setPhases((currentPhases) =>
      currentPhases.map((phase) =>
        phase.id === phaseId ? { ...phase, status } : phase
      )
    );

    const supabase = createBrowserSupabaseClient();
    const { error: updateError } = await supabase
      .from("project_progress_phases")
      .update({ status })
      .eq("id", phaseId);

    setSavingPhaseId("");

    if (updateError) {
      setPhases(previousPhases);
      setError(updateError.message);
    }
  }

  async function toggleChecklistItem(itemId: string, isComplete: boolean) {
    const previousPhases = phases;

    setSavingItemId(itemId);
    setError("");
    setPhases((currentPhases) =>
      currentPhases.map((phase) => ({
        ...phase,
        checklistItems: phase.checklistItems.map((item) =>
          item.id === itemId ? { ...item, is_complete: isComplete } : item
        )
      }))
    );

    const supabase = createBrowserSupabaseClient();
    const { error: updateError } = await supabase
      .from("project_progress_checklist_items")
      .update({ is_complete: isComplete })
      .eq("id", itemId);

    setSavingItemId("");

    if (updateError) {
      setPhases(previousPhases);
      setError(updateError.message);
    }
  }

  if (isLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">Loading progress tracker...</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-meadow">Roadmap progress</p>
            <h2 className="mt-2 text-2xl font-semibold text-ink">
              Project phase tracker
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Update implementation status and checklist completion as each
              MeetingVA AI phase moves forward.
            </p>
          </div>
          <div className="min-w-32 rounded-lg border border-slate-200 bg-mist p-4 text-center">
            <p className="text-3xl font-semibold text-ink">
              {completionPercentage}%
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              Complete
            </p>
          </div>
        </div>
        <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-meadow transition-all"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </section>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4">
        {phases.map((phase) => (
          <article
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            key={phase.id}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold text-ink">
                    {phase.title}
                  </h3>
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${getStatusClasses(
                      phase.status
                    )}`}
                  >
                    {
                      statusOptions.find(
                        (option) => option.value === phase.status
                      )?.label
                    }
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {phase.description}
                </p>
              </div>

              <label className="flex min-w-48 flex-col gap-2 text-sm font-medium text-ink">
                Status
                <select
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-signal focus:ring-2 focus:ring-blue-100 disabled:cursor-wait disabled:text-slate-400"
                  value={phase.status}
                  onChange={(event) =>
                    updatePhaseStatus(
                      phase.id,
                      event.target.value as PhaseStatus
                    )
                  }
                  disabled={savingPhaseId === phase.id}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 grid gap-3">
              {phase.checklistItems.map((item) => (
                <label
                  className="flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
                  key={item.id}
                >
                  <input
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-meadow focus:ring-meadow disabled:cursor-wait"
                    type="checkbox"
                    checked={item.is_complete}
                    disabled={savingItemId === item.id}
                    onChange={(event) =>
                      toggleChecklistItem(item.id, event.target.checked)
                    }
                  />
                  <span
                    className={
                      item.is_complete ? "text-slate-500 line-through" : ""
                    }
                  >
                    {item.label}
                  </span>
                </label>
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
