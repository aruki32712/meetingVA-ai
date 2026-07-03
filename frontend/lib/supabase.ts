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
  | "transcribing"
  | "transcribed"
  | "transcription_failed"
  | "processing"
  | "completed"
  | "failed";

type AttachmentKind = "audio" | "transcript" | "document" | "image" | "other";

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
      transcript_segments: {
        Row: {
          id: string;
          meeting_id: string;
          participant_id: string | null;
          speaker_label: string | null;
          start_ms: number;
          end_ms: number;
          text: string;
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
    Functions: Record<string, never>;
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
