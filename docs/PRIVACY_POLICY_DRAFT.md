# MeetingVA AI Privacy Policy Draft

Last updated: 2026-07-07

This is a draft for review before public launch. It is not legal advice.

## Overview

MeetingVA AI helps users record meetings, store meeting records, generate transcripts, and create AI-generated summaries, action items, decisions, and questions.

## Information We Process

MeetingVA AI may process:

- Account information such as email address and authentication metadata.
- Meeting metadata such as title, date, description, duration, and tags.
- Meeting audio recordings.
- Transcripts and speaker labels.
- AI-generated summaries, briefs, action items, decisions, and questions.
- Usage, error, and audit metadata needed to secure and operate the service.

## How Information Is Used

Information is used to:

- Provide meeting recording and review features.
- Generate transcripts and meeting intelligence.
- Secure user accounts and meeting records.
- Troubleshoot failures and improve reliability.
- Communicate with users about product or support issues.

## AI Processing

MeetingVA AI sends meeting audio or transcript text to AI providers for transcription, translation, and analysis. API keys are stored only in backend or worker environments. Users should avoid submitting sensitive regulated data during the MVP stage.

## Storage And Access

Meeting data is stored in Supabase PostgreSQL and Supabase Storage. Meeting audio buckets are private. Application access is scoped by Supabase Auth, Row Level Security, and backend ownership checks.

## Data Sharing

MeetingVA AI does not sell meeting content. Data may be processed by infrastructure and AI service providers needed to operate the product.

## Data Retention

Retention rules are defined in `docs/DATA_RETENTION.md`. Current MVP behavior keeps meeting records until the user or operator deletes them; automated retention enforcement is not yet implemented.

## Security

Security controls are documented in `docs/SECURITY.md`.

## HIPAA And Regulated Data

MeetingVA AI is not HIPAA compliant today. Users must not use the MVP to process protected health information or regulated healthcare data until Walter Labs AI completes a formal compliance review and signs required agreements.

## User Requests

Before public launch, Walter Labs AI should define support procedures for:

- Account deletion.
- Meeting deletion.
- Data export.
- Retention changes.
- Security incident questions.

