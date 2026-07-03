# Shared API Contract

This file captures the first stable service boundaries. Feature APIs will be
added after the scaffold is running locally.

## Health

### Frontend

`GET /api/health`

```json
{
  "status": "ok",
  "service": "meetingva-ai-frontend"
}
```

### Backend

`GET /health`

```json
{
  "status": "ok",
  "service": "meetingva-ai-backend",
  "environment": "local"
}
```

## Data Model

The initial Supabase migration defines:

- `meetings`
- `participants`
- `transcript_segments`
- `action_items`
- `decisions`
- `questions`
- `tags`
- `meeting_tags`
- `attachments`

## Meetings

### Generate Transcript

`POST /v1/meetings/{meeting_id}/transcribe`

Requires a Supabase access token:

```http
Authorization: Bearer <supabase-access-token>
```

The backend validates the user, confirms the meeting belongs to that user,
downloads the private audio file from the `meeting-audio` Supabase Storage
bucket, sends it to OpenAI transcription, replaces existing transcript segments
for that meeting, and updates `meetings.processing_status`.

Success response:

```json
{
  "meeting_id": "meeting-uuid",
  "processing_status": "transcribed",
  "segment_count": 12
}
```
