from pathlib import Path


ROOT = Path(__file__).parents[2]
MAIN = (ROOT / "backend" / "app" / "main.py").read_text(encoding="utf-8")
WORKER = (ROOT / "backend" / "app" / "workers" / "analysis_worker.py").read_text(
    encoding="utf-8"
)
MIGRATION = (
    ROOT / "scripts" / "supabase" / "migrations" / "0029_transcript_revision_analysis.sql"
).read_text(encoding="utf-8")


def test_manual_edits_increment_revision_and_mark_analysis_stale():
    assert "transcript_revision = transcript_revision + 1" in MIGRATION
    assert "analysis_stale = true" in MIGRATION
    assert "transcript_updated" in MIGRATION


def test_analysis_job_captures_latest_transcript_revision():
    assert 'transcript_revision = int(meeting.get("transcript_revision") or 1)' in MAIN
    assert '"transcript_revision": transcript_revision' in MAIN
    assert "transcript_revision=transcript_revision" in WORKER


def test_stale_analysis_result_cannot_overwrite_newer_analysis():
    assert "where id = p_meeting_id and transcript_revision = p_transcript_revision" in MIGRATION
    assert "return false" in MIGRATION
    assert '"processing_status": "cancelled"' in MAIN


def test_analysis_success_clears_stale_only_for_matching_revision():
    assert "analysis_stale = false" in MIGRATION
    assert "analysis_revision = p_transcript_revision" in MIGRATION
    assert "commit_meeting_analysis" in MAIN


def test_split_is_committed_and_revisioned_before_analysis_can_be_enqueued():
    assert "split_transcript_segment_revisioned" in MIGRATION
    split_call = MIGRATION.index("split_result := public.split_transcript_segment")
    revision_call = MIGRATION.index("new_revision := public.mark_transcript_manually_edited")
    assert split_call < revision_call
    assert "analyze_meeting_task.apply_async" not in MIGRATION


def test_analysis_failure_does_not_roll_back_manual_transcript_edits():
    split_handler = MAIN[MAIN.index("async def split_transcript_segment") :]
    analyze_handler = MAIN[MAIN.index("async def analyze_meeting") :]
    assert "split_transcript_segment_revisioned" in split_handler
    assert "_mark_processing_job_failed" in analyze_handler
    assert 'table("transcript_segments").delete' not in analyze_handler

