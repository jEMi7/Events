export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          booking_id: string | null
          created_at: string
          detail: Json
          event_id: string | null
          id: string
          next_value: Json | null
          note: string | null
          person_id: string | null
          previous_value: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          booking_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: string
          next_value?: Json | null
          note?: string | null
          person_id?: string | null
          previous_value?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          booking_id?: string | null
          created_at?: string
          detail?: Json
          event_id?: string | null
          id?: string
          next_value?: Json | null
          note?: string | null
          person_id?: string | null
          previous_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      attendee_operational_statuses: {
        Row: {
          actual_attendance: string
          assigned_to: string | null
          attendance_intent: string
          booking_id: string
          callback_at: string | null
          last_contacted_at: string | null
          last_contacted_by: string | null
          updated_at: string
        }
        Insert: {
          actual_attendance?: string
          assigned_to?: string | null
          attendance_intent?: string
          booking_id: string
          callback_at?: string | null
          last_contacted_at?: string | null
          last_contacted_by?: string | null
          updated_at?: string
        }
        Update: {
          actual_attendance?: string
          assigned_to?: string | null
          attendance_intent?: string
          booking_id?: string
          callback_at?: string | null
          last_contacted_at?: string | null
          last_contacted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_operations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_operations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_operations_last_contacted_by_fkey"
            columns: ["last_contacted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      callback_tasks: {
        Row: {
          booking_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          due_at: string
          id: string
          note: string | null
          owner_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at: string
          id?: string
          note?: string | null
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string
          id?: string
          note?: string | null
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "callback_tasks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callback_tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "callback_tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          body: string
          booking_id: string
          created_at: string
          created_by: string | null
          event_id: string | null
          id: string
          person_id: string | null
        }
        Insert: {
          body: string
          booking_id: string
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          person_id?: string | null
        }
        Update: {
          body?: string
          booking_id?: string
          created_at?: string
          created_by?: string | null
          event_id?: string | null
          id?: string
          person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "event_bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      event_bookings: {
        Row: {
          booking_key: string
          booking_status: string | null
          created_at: string
          data_origin: string
          event_id: string
          id: string
          last_synced_at: string | null
          meeting_url: string | null
          person_id: string
          raw_payload: Json
          source_account: string | null
          source_attendee_id: string | null
          source_event_id: string | null
          source_sheet: string
          updated_at: string
        }
        Insert: {
          booking_key: string
          booking_status?: string | null
          created_at?: string
          data_origin?: string
          event_id: string
          id?: string
          last_synced_at?: string | null
          meeting_url?: string | null
          person_id: string
          raw_payload?: Json
          source_account?: string | null
          source_attendee_id?: string | null
          source_event_id?: string | null
          source_sheet?: string
          updated_at?: string
        }
        Update: {
          booking_key?: string
          booking_status?: string | null
          created_at?: string
          data_origin?: string
          event_id?: string
          id?: string
          last_synced_at?: string | null
          meeting_url?: string | null
          person_id?: string
          raw_payload?: Json
          source_account?: string | null
          source_attendee_id?: string | null
          source_event_id?: string | null
          source_sheet?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_bookings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_bookings_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          data_origin: string
          description: string | null
          end_at: string | null
          event_name: string
          id: string
          last_synced_at: string | null
          master_event_key: string
          meeting_url: string | null
          raw_payload: Json
          source_event_id: string | null
          source_sheet: string
          start_at: string | null
          status: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_origin?: string
          description?: string | null
          end_at?: string | null
          event_name: string
          id?: string
          last_synced_at?: string | null
          master_event_key: string
          meeting_url?: string | null
          raw_payload?: Json
          source_event_id?: string | null
          source_sheet?: string
          start_at?: string | null
          status?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_origin?: string
          description?: string | null
          end_at?: string | null
          event_name?: string
          id?: string
          last_synced_at?: string | null
          master_event_key?: string
          meeting_url?: string | null
          raw_payload?: Json
          source_event_id?: string | null
          source_sheet?: string
          start_at?: string | null
          status?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      header_mappings: {
        Row: {
          created_at: string
          id: string
          source_header: string
          tab_name: string
          target_field: string
        }
        Insert: {
          created_at?: string
          id?: string
          source_header: string
          tab_name: string
          target_field: string
        }
        Update: {
          created_at?: string
          id?: string
          source_header?: string
          tab_name?: string
          target_field?: string
        }
        Relationships: []
      }
      people: {
        Row: {
          created_at: string
          data_origin: string
          email: string | null
          email_normalised: string | null
          full_name: string
          id: string
          identity_key: string
          job_title: string | null
          last_synced_at: string | null
          phone: string | null
          raw_payload: Json
          source_attendee_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_origin?: string
          email?: string | null
          email_normalised?: string | null
          full_name: string
          id?: string
          identity_key: string
          job_title?: string | null
          last_synced_at?: string | null
          phone?: string | null
          raw_payload?: Json
          source_attendee_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_origin?: string
          email?: string | null
          email_normalised?: string | null
          full_name?: string
          id?: string
          identity_key?: string
          job_title?: string | null
          last_synced_at?: string | null
          phone?: string | null
          raw_payload?: Json
          source_attendee_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_runs: {
        Row: {
          attendees_read: number
          bookings_upserted: number
          detail: Json
          error_message: string | null
          events_read: number
          events_upserted: number
          finished_at: string | null
          id: string
          people_upserted: number
          skipped_rows: number
          source: string
          started_at: string
          status: string
          triggered_by: string | null
        }
        Insert: {
          attendees_read?: number
          bookings_upserted?: number
          detail?: Json
          error_message?: string | null
          events_read?: number
          events_upserted?: number
          finished_at?: string | null
          id?: string
          people_upserted?: number
          skipped_rows?: number
          source?: string
          started_at?: string
          status: string
          triggered_by?: string | null
        }
        Update: {
          attendees_read?: number
          bookings_upserted?: number
          detail?: Json
          error_message?: string | null
          events_read?: number
          events_upserted?: number
          finished_at?: string | null
          id?: string
          people_upserted?: number
          skipped_rows?: number
          source?: string
          started_at?: string
          status?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_profile: { Args: { _full_name?: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "staff"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
    },
  },
} as const
