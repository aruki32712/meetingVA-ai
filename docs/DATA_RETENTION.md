# MeetingVA AI Data Retention

Last updated: 2026-07-07

This document defines the current retention posture and future retention requirements.

## Current MVP Retention

MeetingVA AI currently retains user-created meeting records until they are manually deleted from the application database or storage by an authorized operator. Automated retention enforcement is not yet implemented.

Data retained today can include:

- Account identifiers.
- Meeting metadata.
- Audio storage paths and audio objects.
- Attachments.
- Transcript segments.
- Participants and speaker labels.
- AI-generated summaries, briefs, action items, decisions, and questions.
- Audit logs after migration `0008_security_foundation.sql` is applied.

## Recommended MVP Policy

Before public launch, define a user-facing retention policy:

- Free: shorter retention and lower storage limits.
- Pro: longer retention for individual meeting history.
- Team: workspace retention controlled by workspace owner.
- Enterprise: custom retention only after enterprise compliance work exists.

## Deletion Requirements

Deletion should eventually remove or anonymize:

- Meeting row.
- Transcript segments.
- Participants.
- Action items.
- Decisions.
- Questions.
- Attachments.
- Storage objects in `meeting-audio` and `meeting-attachments`.
- Related audit metadata where legally and operationally appropriate.

## Backup And Audit Logs

Backups and audit logs may need separate retention windows. Those windows should be documented before public launch and reviewed before regulated or enterprise use.

## HIPAA Boundary

MeetingVA AI is not HIPAA compliant today. Retention controls for protected health information are not implemented. Do not process PHI until formal compliance review is complete.

## Future Work

- Add user-facing meeting deletion.
- Add storage object cleanup.
- Add account deletion workflow.
- Add export workflow.
- Add retention settings by plan.
- Add retention enforcement jobs.
- Document backup retention by environment.

