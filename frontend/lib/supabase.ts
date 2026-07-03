import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type ProjectProgressStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "complete";

type Database = {
  public: {
    Tables: {
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
