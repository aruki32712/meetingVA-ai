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
