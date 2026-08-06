# Speaker diarization

MeetingVA sends the original uploaded audio bytes to Deepgram's prerecorded
Listen API. It does not resample, remix, transcode, or collapse audio channels.
The production request uses Nova-3 transcription with the latest batch
diarization model, plus utterances, punctuation, and smart formatting.

Deepgram's current prerecorded API does not expose expected, minimum, or maximum
speaker-count parameters. `meetings.expected_speaker_count` is therefore stored
for diagnostics and future providers only; it is never sent as an unsupported
Deepgram query parameter and does not guarantee a detected speaker count.

Deepgram supports `multichannel=true`, which transcribes every channel
independently. MeetingVA leaves it disabled because ordinary browser stereo
recordings do not guarantee one isolated speaker per channel. Enabling it for
mixed or duplicated stereo can produce duplicate transcripts, and speaker IDs
are scoped independently within each returned channel.

Recommended production configuration:

- `DIARIZATION_MODEL=nova-3`
- `DIARIZATION_MODEL_VERSION=latest` (currently the v2 batch diarizer)
- `DIARIZATION_MINIMUM_CONFIDENCE=0.5` until diagnostics from representative
  consented recordings demonstrate that a lower alignment threshold retains
  valid speakers without increasing incorrect assignments
- Preserve original audio channels and sample rate

Speaker diarization remains probabilistic. Similar voices, background noise,
short utterances, distant microphones, and overlapping speech can reduce the
number of speakers detected or leave words unassigned.

## Admin/development model comparison

`DIARIZATION_MODEL_VERSION` accepts only `latest`, `v2`, or `v1`; normal
transcription sends exactly one Deepgram request using the configured value.
For a consented local recording, an administrator or developer can explicitly
compare all three versions from the backend directory:

```powershell
python -m scripts.compare_diarization_models C:\path\to\recording.wav --consent-confirmed
```

The command makes three provider requests and logs only model version, response
status, duration, speaker IDs/counts, utterance counts, and safe audio metadata.
It is not exposed through the user-facing API or frontend.

Each run reuses the exact original file bytes and detected MIME type. The command
does not connect to Supabase, create transcript rows or participants, enqueue
jobs, or modify the meeting. If Deepgram no longer supports `v1`, that comparison
is retained as a compact failed result with its HTTP status rather than affecting
the supported model results.

The JSON output includes unique raw speakers, words and speaking milliseconds by
speaker, utterance and unknown-word counts, HTTP status, and elapsed time. Set the
optional `DIARIZATION_COST_PER_MINUTE_USD` from the organization's current
Deepgram contract to include an estimate; MeetingVA does not hardcode pricing.
For example:

```json
[
  {
    "provider": "deepgram",
    "model": "latest",
    "http_status": 200,
    "speaker_count": 3,
    "unique_raw_speaker_ids": ["0", "1", "2"],
    "utterance_count": 17,
    "unknown_word_count": 12,
    "elapsed_ms": 98000,
    "estimated_provider_cost_usd": null,
    "best_speaker_separation": true
  }
]
```

The harness marks the successful result with the highest speaker count and then
the fewest unknown words as `best_speaker_separation`; ties remain visible.
Review the speaker-duration distribution before adopting a result. A model can
be called the best separator for a recording only
after this command has been run on that consented recording; unit-test fixtures
are not evidence about production audio.

MeetingVA preserves the uploaded sample rate and channel layout. Deepgram's
`multichannel=true` mode is appropriate only when separate input channels
actually contain separate speakers. It is not interchangeable with diarization
for an ordinary mixed stereo recording and remains disabled in the normal
pipeline.
