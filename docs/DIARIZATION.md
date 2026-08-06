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

MeetingVA preserves the uploaded sample rate and channel layout. Deepgram's
`multichannel=true` mode is appropriate only when separate input channels
actually contain separate speakers. It is not interchangeable with diarization
for an ordinary mixed stereo recording and remains disabled in the normal
pipeline.
