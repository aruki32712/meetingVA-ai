import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type ProjectProgressStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "complete";

type MeetingStatus =
  | "draft"
  | "recording"
  | "processing"
  | "completed"
  | "archived";

type AttachmentKind = "audio" | "transcript" | "document" | "image" | "other";
type TranscriptKind = "original" | "translated" | "both";
type TranslationStatus =
  | "not_requested"
  | "not_needed"
  | "translated"
  | "failed";
type ProcessingJobType = "transcription" | "analysis";
type ProcessingJobStatus =
  | "queued"
  | "transcribing"
  | "transcribed"
  | "analyzing"
  | "analyzed"
  | "failed"
  | "cancelled";
type ProcessingEventStatus = "pending" | "current" | "completed" | "failed";

type Database = {
  public: {
    Tables: {
      meetings: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string | null;
          status: MeetingStatus;
          scheduled_at: string | null;
          started_at: string | null;
          ended_at: string | null;
          source: string | null;
          audio_storage_path: string | null;
          duration_seconds: number | null;
          summary: string | null;
          brief: string | null;
          summary_translated: string | null;
          brief_translated: string | null;
          detected_language: string | null;
          transcript_language: string | null;
          translation_language: string | null;
          translate_to_english: boolean;
          transcript_kind: TranscriptKind;
          translation_status: TranslationStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description?: string | null;
          status?: MeetingStatus;
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          source?: string | null;
          audio_storage_path?: string | null;
          duration_seconds?: number | null;
          summary?: string | null;
          brief?: string | null;
          summary_translated?: string | null;
          brief_translated?: string | null;
          detected_language?: string | null;
          transcript_language?: string | null;
          translation_language?: string | null;
          translate_to_english?: boolean;
          transcript_kind?: TranscriptKind;
          translation_status?: TranslationStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string | null;
          status?: MeetingStatus;
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          source?: string | null;
          audio_storage_path?: string | null;
          duration_seconds?: number | null;
          summary?: string | null;
          brief?: string | null;
          summary_translated?: string | null;
          brief_translated?: string | null;
          detected_language?: string | null;
          transcript_language?: string | null;
          translation_language?: string | null;
          translate_to_english?: boolean;
          transcript_kind?: TranscriptKind;
          translation_status?: TranslationStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      attachments: {
        Row: {
          id: string;
          meeting_id: string;
          uploaded_by: string | null;
          kind: AttachmentKind;
          file_name: string;
          storage_bucket: string;
          storage_path: string;
          content_type: string | null;
          size_bytes: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          uploaded_by?: string | null;
          kind?: AttachmentKind;
          file_name: string;
          storage_bucket?: string;
          storage_path: string;
          content_type?: string | null;
          size_bytes?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          uploaded_by?: string | null;
          kind?: AttachmentKind;
          file_name?: string;
          storage_bucket?: string;
          storage_path?: string;
          content_type?: string | null;
          size_bytes?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      processing_events: {
        Row: {
          id: string;
          event_order: number;
          meeting_id: string;
          user_id: string;
          job_id: string | null;
          job_type: ProcessingJobType | null;
          event_type: string;
          status: ProcessingEventStatus;
          message: string;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_order?: never;
          meeting_id: string;
          user_id: string;
          job_id?: string | null;
          job_type?: ProcessingJobType | null;
          event_type: string;
          status: ProcessingEventStatus;
          message: string;
          error_message?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_order?: never;
          meeting_id?: string;
          user_id?: string;
          job_id?: string | null;
          job_type?: ProcessingJobType | null;
          event_type?: string;
          status?: ProcessingEventStatus;
          message?: string;
          error_message?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "processing_events_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      processing_jobs: {
        Row: {
          id: string;
          meeting_id: string;
          job_type: ProcessingJobType;
          status: ProcessingJobStatus;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          retry_count: number;
          worker_version: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          job_type: ProcessingJobType;
          status?: ProcessingJobStatus;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          retry_count?: number;
          worker_version?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          job_type?: ProcessingJobType;
          status?: ProcessingJobStatus;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          retry_count?: number;
          worker_version?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "processing_jobs_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      participants: {
        Row: {
          id: string;
          meeting_id: string;
          display_name: string;
          email: string | null;
          role: string | null;
          speaker_label: string | null;
          source: string;
          voiceprint_ref: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          display_name: string;
          email?: string | null;
          role?: string | null;
          speaker_label?: string | null;
          source?: string;
          voiceprint_ref?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          display_name?: string;
          email?: string | null;
          role?: string | null;
          speaker_label?: string | null;
          source?: string;
          voiceprint_ref?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "participants_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      transcript_segments: {
        Row: {
          id: string;
          meeting_id: string;
          participant_id: string | null;
          speaker_label: string | null;
          start_ms: number;
          end_ms: number;
          text: string;
          original_text: string | null;
          translated_text: string | null;
          transcript_kind: TranscriptKind;
          confidence: number | null;
          segment_index: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          participant_id?: string | null;
          speaker_label?: string | null;
          start_ms: number;
          end_ms: number;
          text: string;
          original_text?: string | null;
          translated_text?: string | null;
          transcript_kind?: TranscriptKind;
          confidence?: number | null;
          segment_index: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          participant_id?: string | null;
          speaker_label?: string | null;
          start_ms?: number;
          end_ms?: number;
          text?: string;
          original_text?: string | null;
          translated_text?: string | null;
          transcript_kind?: TranscriptKind;
          confidence?: number | null;
          segment_index?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transcript_segments_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      action_items: {
        Row: {
          id: string;
          meeting_id: string;
          assignee_participant_id: string | null;
          title: string;
          description: string | null;
          translated_title: string | null;
          translated_description: string | null;
          status: "open" | "in_progress" | "completed" | "cancelled";
          due_at: string | null;
          source_segment_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          assignee_participant_id?: string | null;
          title: string;
          description?: string | null;
          translated_title?: string | null;
          translated_description?: string | null;
          status?: "open" | "in_progress" | "completed" | "cancelled";
          due_at?: string | null;
          source_segment_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          assignee_participant_id?: string | null;
          title?: string;
          description?: string | null;
          translated_title?: string | null;
          translated_description?: string | null;
          status?: "open" | "in_progress" | "completed" | "cancelled";
          due_at?: string | null;
          source_segment_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "action_items_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      decisions: {
        Row: {
          id: string;
          meeting_id: string;
          title: string;
          description: string | null;
          translated_title: string | null;
          translated_description: string | null;
          source_segment_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          title: string;
          description?: string | null;
          translated_title?: string | null;
          translated_description?: string | null;
          source_segment_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          title?: string;
          description?: string | null;
          translated_title?: string | null;
          translated_description?: string | null;
          source_segment_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "decisions_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      questions: {
        Row: {
          id: string;
          meeting_id: string;
          participant_id: string | null;
          question: string;
          answer: string | null;
          translated_question: string | null;
          translated_answer: string | null;
          status: "open" | "answered" | "deferred";
          source_segment_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          participant_id?: string | null;
          question: string;
          answer?: string | null;
          translated_question?: string | null;
          translated_answer?: string | null;
          status?: "open" | "answered" | "deferred";
          source_segment_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          participant_id?: string | null;
          question?: string;
          answer?: string | null;
          translated_question?: string | null;
          translated_answer?: string | null;
          status?: "open" | "answered" | "deferred";
          source_segment_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "questions_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          }
        ];
      };
      project_progress_phases: {
        Row: {
          id: string;
          owner_id: string;
          title: string;
          description: string;
          status: ProjectProgressStatus;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description: string;
          status?: ProjectProgressStatus;
          position: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          title?: string;
          description?: string;
          status?: ProjectProgressStatus;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_progress_checklist_items: {
        Row: {
          id: string;
          phase_id: string;
          label: string;
          is_complete: boolean;
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          phase_id: string;
          label: string;
          is_complete?: boolean;
          position: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          phase_id?: string;
          label?: string;
          is_complete?: boolean;
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_progress_checklist_items_phase_id_fkey";
            columns: ["phase_id"];
            isOneToOne: false;
            referencedRelation: "project_progress_phases";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      search_meetings: {
        Args: {
          search_text?: string;
          date_from?: string | null;
          date_to?: string | null;
          status_filter?: string | null;
          participant_filter?: string | null;
          tag_filter?: string | null;
          result_limit?: number;
        };
        Returns: Array<{
          meeting_id: string;
          meeting_title: string;
          scheduled_at: string | null;
          meeting_status: string;
          matching_excerpt: string;
          match_type: string;
          match_anchor: string | null;
          rank: number;
          additional_match_types: string[];
        }>;
      };
    };
    Enums: {
      attachment_kind: AttachmentKind;
      meeting_status: MeetingStatus;
      project_progress_status: ProjectProgressStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

let browserClient: ReturnType<typeof createClient<Database>> | null = null;

export function createBrowserSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (!browserClient) {
    browserClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  return browserClient;
}
