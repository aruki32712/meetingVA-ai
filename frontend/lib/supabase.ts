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

type MeetingProcessingStatus =
  | "draft"
  | "uploaded"
  | "queued"
  | "transcribing"
  | "transcribed"
  | "transcription_failed"
  | "analyzing"
  | "analyzed"
  | "analysis_failed"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

type AttachmentKind = "audio" | "transcript" | "document" | "image" | "other";
type TranscriptKind = "original" | "translated" | "both";
type ProcessingJobType = "transcription" | "analysis";
type ProcessingEventStatus = "pending" | "current" | "completed" | "failed";
type ActivityActorType = "system" | "owner" | "worker";

type Database = {
  public: {
    Tables: {
      meetings: {
        Row: {
          id: string;
          owner_id: string;
          user_id: string;
          title: string;
          description: string | null;
          status: MeetingStatus;
          meeting_date: string;
          scheduled_at: string | null;
          started_at: string | null;
          ended_at: string | null;
          source: string | null;
          audio_storage_path: string | null;
          duration_seconds: number | null;
          processing_status: MeetingProcessingStatus;
          summary: string | null;
          brief: string | null;
          detected_language: string | null;
          transcript_language: string | null;
          translation_language: string | null;
          translate_to_english: boolean;
          transcript_kind: TranscriptKind;
          tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          user_id: string;
          title: string;
          description?: string | null;
          status?: MeetingStatus;
          meeting_date: string;
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          source?: string | null;
          audio_storage_path?: string | null;
          duration_seconds?: number | null;
          processing_status?: MeetingProcessingStatus;
          summary?: string | null;
          brief?: string | null;
          detected_language?: string | null;
          transcript_language?: string | null;
          translation_language?: string | null;
          translate_to_english?: boolean;
          transcript_kind?: TranscriptKind;
          tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          user_id?: string;
          title?: string;
          description?: string | null;
          status?: MeetingStatus;
          meeting_date?: string;
          scheduled_at?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          source?: string | null;
          audio_storage_path?: string | null;
          duration_seconds?: number | null;
          processing_status?: MeetingProcessingStatus;
          summary?: string | null;
          brief?: string | null;
          detected_language?: string | null;
          transcript_language?: string | null;
          translation_language?: string | null;
          translate_to_english?: boolean;
          transcript_kind?: TranscriptKind;
          tags?: string[];
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
      meeting_activity_events: {
        Row: {
          id: string;
          meeting_id: string;
          user_id: string;
          event_type: string;
          actor_type: ActivityActorType;
          actor_label: string;
          title: string;
          description: string | null;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          user_id: string;
          event_type: string;
          actor_type: ActivityActorType;
          actor_label: string;
          title: string;
          description?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          user_id?: string;
          event_type?: string;
          actor_type?: ActivityActorType;
          actor_label?: string;
          title?: string;
          description?: string | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meeting_activity_events_meeting_id_fkey";
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
          source_segment_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          title: string;
          description?: string | null;
          source_segment_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          meeting_id?: string;
          title?: string;
          description?: string | null;
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
          search_query?: string;
          date_from?: string;
          date_to?: string;
          status_filter?: string;
          participant_filter?: string;
          tag_filter?: string;
          result_limit?: number;
        };
        Returns: {
          meeting_id: string;
          meeting_title: string;
          meeting_date: string;
          processing_status: string;
          matching_excerpt: string;
          match_type: string;
          rank: number;
        }[];
      };
    };
    Enums: {
      attachment_kind: AttachmentKind;
      meeting_processing_status: MeetingProcessingStatus;
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
