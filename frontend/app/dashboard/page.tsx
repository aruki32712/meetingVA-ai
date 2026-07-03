import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-meadow">MVP workspace</p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">
          Build progress is ready to track
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Use the progress tracker to review project phases, update phase
          statuses, and check off implementation tasks as MeetingVA AI moves
          through the roadmap.
        </p>
        <Link
          className="mt-5 inline-flex rounded-md bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          href="/dashboard/progress"
        >
          Open progress tracker
        </Link>
      </section>

      <section className="grid gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-ink">Meetings</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Recording, upload, and meeting review workflows are intentionally
            waiting for later roadmap phases.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-base font-semibold text-ink">Current focus</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Dashboard navigation and project progress are the active MVP
            surfaces.
          </p>
        </div>
      </section>
    </div>
  );
}
