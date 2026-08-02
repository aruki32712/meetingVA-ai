"use client";

import { useEffect, useRef, useState } from "react";
import {
  canSubmitExport, DEFAULT_EXPORT_SELECTIONS, EXPORT_SECTION_KEYS, requestMeetingExport,
  setAllAvailableSections, tryBeginExport, type ExportFormat, type ExportSectionKey, type ExportSelections
} from "./meeting-export-state";

const labels: Record<ExportSectionKey, string> = {
  meeting_details: "Meeting details", executive_summary: "Executive Summary",
  meeting_brief: "Meeting Brief", speakers: "Speakers", transcript: "Transcript",
  timestamps: "Timestamps", action_items: "Action Items", decisions: "Decisions",
  questions: "Questions", tags: "Tags", processing_timeline: "Processing Timeline"
};
const storageKey = "meetingva-export-options-v1";

type Props = {
  meetingId: string;
  meetingTitle: string;
  apiBaseUrl: string;
  accessToken: () => Promise<string>;
  availability: Partial<Record<ExportSectionKey, boolean>>;
  englishTranslationAvailable: boolean;
};

export function MeetingExportDialog(props: Props) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [language, setLanguage] = useState<"original" | "english">("original");
  const [sections, setSections] = useState<ExportSelections>(DEFAULT_EXPORT_SELECTIONS);
  const [acceptFallback, setAcceptFallback] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved?.format) setFormat(saved.format);
      if (saved?.language) setLanguage(saved.language);
      if (saved?.sections) setSections({ ...DEFAULT_EXPORT_SELECTIONS, ...saved.sections });
    } catch { /* Ignore invalid local preferences. */ }
  }, []);

  useEffect(() => {
    if (!props.englishTranslationAvailable && language === "english") {
      setLanguage("original");
      setAcceptFallback(false);
    }
  }, [language, props.englishTranslationAvailable]);

  const effectiveSections = Object.fromEntries(
    EXPORT_SECTION_KEYS.map((key) => [
      key,
      sections[key] && props.availability[key] !== false &&
        (key !== "timestamps" || sections.transcript)
    ])
  ) as ExportSelections;

  async function submit() {
    if (!canSubmitExport(format, effectiveSections, running) || !tryBeginExport(inFlight)) return;
    if (language === "english" && !acceptFallback) {
      setError("Confirm that unavailable English translations may be labeled and shown in the original language.");
      return;
    }
    setRunning(true); setError("");
    try {
      const token = await props.accessToken();
      const result = await requestMeetingExport({
        url: `${props.apiBaseUrl}/v1/meetings/${props.meetingId}/export`,
        token,
        body: { format, language, sections: effectiveSections }
      });
      const filename = result.filename ?? `${props.meetingTitle}.${format}`;
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
      URL.revokeObjectURL(url);
      localStorage.setItem(storageKey, JSON.stringify({ format, language, sections: effectiveSections }));
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to prepare the meeting export.");
    } finally {
      inFlight.current = false; setRunning(false);
    }
  }

  return <>
    <button className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-slate-50" type="button" onClick={() => { setError(""); setOpen(true); }}>Export Meeting</button>
    {open ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label="Export Meeting">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-semibold text-ink">Export Meeting</h2><p className="mt-1 text-sm text-slate-600">Choose the file, language, and sections to include.</p></div><button type="button" onClick={() => !running && setOpen(false)}>Close</button></div>
        <fieldset className="mt-6"><legend className="text-sm font-semibold text-ink">File format</legend><div className="mt-2 flex flex-wrap gap-3">{(["pdf","docx","md","txt","json"] as ExportFormat[]).map((value) => <label className="text-sm" key={value}><input type="radio" name="export-format" value={value} checked={format === value} onChange={() => setFormat(value)} /> {value === "docx" ? "Word (.docx)" : value === "md" ? "Markdown (.md)" : value === "txt" ? "Plain text (.txt)" : value.toUpperCase()}</label>)}</div></fieldset>
        <fieldset className="mt-5"><legend className="text-sm font-semibold text-ink">Language</legend><div className="mt-2 grid gap-2"><label className="text-sm"><input type="radio" checked={language === "original"} onChange={() => { setLanguage("original"); setAcceptFallback(false); }} /> Original language</label><label className="text-sm"><input type="radio" checked={language === "english"} disabled={!props.englishTranslationAvailable} onChange={() => setLanguage("english")} /> English translation</label>{!props.englishTranslationAvailable ? <p className="text-xs text-slate-500">Generate an English translation before exporting in English.</p> : null}{language === "english" ? <label className="rounded-md bg-amber-50 p-3 text-xs text-amber-900"><input type="checkbox" checked={acceptFallback} onChange={(event) => setAcceptFallback(event.target.checked)} /> I understand unavailable translations will be clearly labeled and shown in the original language.</label> : null}</div></fieldset>
        <div className="mt-5 flex items-center justify-between"><h3 className="text-sm font-semibold text-ink">Include</h3><div className="flex gap-2"><button className="text-xs text-signal" type="button" onClick={() => setSections(setAllAvailableSections(props.availability, true))}>Select All</button><button className="text-xs text-signal" type="button" onClick={() => setSections(setAllAvailableSections(props.availability, false))}>Clear All</button></div></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{EXPORT_SECTION_KEYS.map((key) => { const disabled = props.availability[key] === false || (key === "timestamps" && !sections.transcript); return <label className={`rounded-md border p-3 text-sm ${disabled ? "bg-slate-100 text-slate-400" : "bg-white"}`} key={key}><input type="checkbox" checked={effectiveSections[key]} disabled={disabled} onChange={(event) => setSections((current) => ({ ...current, [key]: event.target.checked }))} /> {labels[key]}{props.availability[key] === false ? <span className="ml-1 text-xs">(unavailable)</span> : null}</label>; })}</div>
        {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3"><button className="rounded-md border px-4 py-2 text-sm" type="button" disabled={running} onClick={() => setOpen(false)}>Cancel</button><button className="rounded-md bg-signal px-4 py-2 text-sm font-medium text-white disabled:bg-slate-300" type="button" disabled={!canSubmitExport(format, effectiveSections, running)} onClick={() => void submit()}>{running ? "Preparing export…" : "Export"}</button></div>
      </div>
    </div> : null}
  </>;
}
