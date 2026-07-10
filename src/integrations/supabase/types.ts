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
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          justification: string | null
          new_value: Json | null
          old_value: Json | null
          organization_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          justification?: string | null
          new_value?: Json | null
          old_value?: Json | null
          organization_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          justification?: string | null
          new_value?: Json | null
          old_value?: Json | null
          organization_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cooperatives: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: []
      }
      core_outputs: {
        Row: {
          document_id: string
          id: string
          module_type: string
          payload: Json
          processed_at: string | null
          version: number
        }
        Insert: {
          document_id: string
          id?: string
          module_type: string
          payload: Json
          processed_at?: string | null
          version?: number
        }
        Update: {
          document_id?: string
          id?: string
          module_type?: string
          payload?: Json
          processed_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "core_outputs_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          agent_name: string
          conclusion: string
          created_at: string
          declarations: string
          doc_date: string | null
          doc_time: string | null
          faits: string
          field_data: Json | null
          id: string
          introduction: string
          lang: string
          location: string
          location_data: Json | null
          mission_type: string | null
          module_type: string | null
          observations: string
          parcelle_id: string | null
          photo_urls: string[]
          reference: string
          signature_name: string
          status: string
          suggestions: string[]
          title: string
          transcript: string
          type: string
          updated_at: string
          user_id: string
          validated_at: string | null
          validated_by: string | null
          video_urls: string[] | null
        }
        Insert: {
          agent_name?: string
          conclusion?: string
          created_at?: string
          declarations?: string
          doc_date?: string | null
          doc_time?: string | null
          faits?: string
          field_data?: Json | null
          id?: string
          introduction?: string
          lang?: string
          location?: string
          location_data?: Json | null
          mission_type?: string | null
          module_type?: string | null
          observations?: string
          parcelle_id?: string | null
          photo_urls?: string[]
          reference?: string
          signature_name?: string
          status?: string
          suggestions?: string[]
          title?: string
          transcript?: string
          type: string
          updated_at?: string
          user_id: string
          validated_at?: string | null
          validated_by?: string | null
          video_urls?: string[] | null
        }
        Update: {
          agent_name?: string
          conclusion?: string
          created_at?: string
          declarations?: string
          doc_date?: string | null
          doc_time?: string | null
          faits?: string
          field_data?: Json | null
          id?: string
          introduction?: string
          lang?: string
          location?: string
          location_data?: Json | null
          mission_type?: string | null
          module_type?: string | null
          observations?: string
          photo_urls?: string[]
          reference?: string
          signature_name?: string
          status?: string
          suggestions?: string[]
          title?: string
          transcript?: string
          type?: string
          updated_at?: string
          user_id?: string
          validated_at?: string | null
          validated_by?: string | null
          video_urls?: string[] | null
        }
        Relationships: []
      }
      mission_forms: {
        Row: {
          created_at: string
          fields: Json
          id: string
          mission_key: string
          mission_label: string
          module_type: string
          organization_id: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          fields?: Json
          id?: string
          mission_key: string
          mission_label: string
          module_type: string
          organization_id?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          fields?: Json
          id?: string
          mission_key?: string
          mission_label?: string
          module_type?: string
          organization_id?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "mission_forms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      modification_requests: {
        Row: {
          created_at: string
          current_value: Json | null
          decided_at: string | null
          decided_by: string | null
          document_id: string
          expires_at: string
          field_name: string
          id: string
          organization_id: string
          proposed_value: Json
          reason: string
          requested_by: string
          status: string
        }
        Insert: {
          created_at?: string
          current_value?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          document_id: string
          expires_at: string
          field_name: string
          id?: string
          organization_id: string
          proposed_value: Json
          reason: string
          requested_by: string
          status?: string
        }
        Update: {
          created_at?: string
          current_value?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          document_id?: string
          expires_at?: string
          field_name?: string
          id?: string
          organization_id?: string
          proposed_value?: Json
          reason?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "modification_requests_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modification_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          enabled_compliance_modules: string[]
          enabled_modules: string[]
          id: string
          modification_request_delay_hours: number
          module_type: string
          name: string
          type: string
        }
        Insert: {
          created_at?: string | null
          enabled_compliance_modules?: string[]
          enabled_modules?: string[]
          id?: string
          modification_request_delay_hours?: number
          module_type: string
          name: string
          type: string
        }
        Update: {
          created_at?: string | null
          enabled_compliance_modules?: string[]
          enabled_modules?: string[]
          id?: string
          modification_request_delay_hours?: number
          module_type?: string
          name?: string
          type?: string
        }
        Relationships: []
      }
      parcelles: {
        Row: {
          boundary_points: Json | null
          cooperative_id: string | null
          created_at: string
          culture: string
          eudr_attested_at: string | null
          eudr_attested_by: string | null
          eudr_deforestation_free: boolean | null
          eudr_notes: string | null
          id: string
          lat: number
          lng: number
          notes: string | null
          organization_id: string
          producer_id: string | null
          registered_by: string | null
          surface_ha: number | null
          surface_ha_calculated: number | null
        }
        Insert: {
          boundary_points?: Json | null
          cooperative_id?: string | null
          created_at?: string
          culture: string
          eudr_attested_at?: string | null
          eudr_attested_by?: string | null
          eudr_deforestation_free?: boolean | null
          eudr_notes?: string | null
          id?: string
          lat: number
          lng: number
          notes?: string | null
          organization_id: string
          producer_id?: string | null
          registered_by?: string | null
          surface_ha?: number | null
          surface_ha_calculated?: number | null
        }
        Update: {
          boundary_points?: Json | null
          cooperative_id?: string | null
          created_at?: string
          culture?: string
          eudr_attested_at?: string | null
          eudr_attested_by?: string | null
          eudr_deforestation_free?: boolean | null
          eudr_notes?: string | null
          id?: string
          lat?: number
          lng?: number
          notes?: string | null
          organization_id?: string
          producer_id?: string | null
          registered_by?: string | null
          surface_ha?: number | null
          surface_ha_calculated?: number | null
        }
        Relationships: []
      }
      producers: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          cooperative_id: string | null
          created_at: string
          full_name: string
          id: string
          id_document_number: string | null
          id_document_type: string | null
          organization_id: string
          registered_by: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          cooperative_id?: string | null
          created_at?: string
          full_name: string
          id?: string
          id_document_number?: string | null
          id_document_type?: string | null
          organization_id: string
          registered_by: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          cooperative_id?: string | null
          created_at?: string
          full_name?: string
          id?: string
          id_document_number?: string | null
          id_document_type?: string | null
          organization_id?: string
          registered_by?: string
        }
        Relationships: []
      }
      agro_advisor_reports: {
        Row: {
          analysis: string
          created_at: string
          documents_analyzed: number
          generated_by: string
          id: string
          organization_id: string
          status: string
          treated_at: string | null
          treated_by: string | null
          treatment_notes: string | null
        }
        Insert: {
          analysis: string
          created_at?: string
          documents_analyzed: number
          generated_by: string
          id?: string
          organization_id: string
          status?: string
          treated_at?: string | null
          treated_by?: string | null
          treatment_notes?: string | null
        }
        Update: {
          analysis?: string
          created_at?: string
          documents_analyzed?: number
          generated_by?: string
          id?: string
          organization_id?: string
          status?: string
          treated_at?: string | null
          treated_by?: string | null
          treatment_notes?: string | null
        }
        Relationships: []
      }
      duplicate_alerts: {
        Row: {
          action: string
          agent_id: string
          created_at: string
          distance_meters: number
          existing_parcelle_id: string
          id: string
          lat: number
          lng: number
          new_parcelle_id: string | null
          organization_id: string
          reason: string | null
          review_notes: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level: string
        }
        Insert: {
          action: string
          agent_id: string
          created_at?: string
          distance_meters: number
          existing_parcelle_id: string
          id?: string
          lat: number
          lng: number
          new_parcelle_id?: string | null
          organization_id: string
          reason?: string | null
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level: string
        }
        Update: {
          action?: string
          agent_id?: string
          created_at?: string
          distance_meters?: number
          existing_parcelle_id?: string
          id?: string
          lat?: number
          lng?: number
          new_parcelle_id?: string | null
          organization_id?: string
          reason?: string | null
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          country: string
          created_at: string
          email: string
          full_name: string
          id: string
          module_type: string
          organization_id: string | null
          organization_name: string
          organization_type: string
          preferred_lang: string
          profession: string
          role_metier: string
          secteur_activite: string
          updated_at: string
        }
        Insert: {
          country?: string
          created_at?: string
          email?: string
          full_name?: string
          id: string
          module_type?: string
          organization_id?: string | null
          organization_name?: string
          organization_type?: string
          preferred_lang?: string
          profession?: string
          role_metier?: string
          secteur_activite?: string
          updated_at?: string
        }
        Update: {
          country?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          module_type?: string
          organization_id?: string | null
          organization_name?: string
          organization_type?: string
          preferred_lang?: string
          profession?: string
          role_metier?: string
          secteur_activite?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          organization_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_modification_request: {
        Args: { _decided_by: string; _new_status: string; _request_id: string }
        Returns: undefined
      }
      has_role: {
        Args: { _role: Database["public"]["Enums"]["app_role"]; _user: string }
        Returns: boolean
      }
      sweep_expired_modification_requests: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "agent" | "supervisor" | "admin" | "platform_admin"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["agent", "supervisor", "admin", "platform_admin"],
    },
  },
} as const
