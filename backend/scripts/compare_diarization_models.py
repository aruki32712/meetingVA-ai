"""Compare Deepgram diarization models on one explicitly consented local file."""

import argparse
import asyncio
import json
import mimetypes
from pathlib import Path

from app.diarization import compare_deepgram_diarization_models
from app.settings import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare Deepgram diarization model versions (admin/development only)."
    )
    parser.add_argument("audio_file", type=Path)
    parser.add_argument(
        "--consent-confirmed",
        action="store_true",
        help="Confirm the recording may be sent to Deepgram for three comparison requests.",
    )
    args = parser.parse_args()
    if not args.consent_confirmed:
        parser.error("--consent-confirmed is required")
    if not args.audio_file.is_file():
        parser.error("audio_file must be an existing file")

    settings = get_settings()
    if not settings.diarization_api_key.strip():
        parser.error("DIARIZATION_API_KEY is required")
    content_type = mimetypes.guess_type(args.audio_file.name)[0] or "application/octet-stream"
    summaries = asyncio.run(
        compare_deepgram_diarization_models(
            audio_bytes=args.audio_file.read_bytes(),
            filename=args.audio_file.name,
            content_type=content_type,
            api_key=settings.diarization_api_key,
        )
    )
    print(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    main()
