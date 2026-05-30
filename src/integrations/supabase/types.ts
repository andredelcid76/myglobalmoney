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
      accounts: {
        Row: {
          color: string | null
          created_at: string
          currency: string
          id: string
          initial_balance: number
          institution: string | null
          is_archived: boolean
          name: string
          type: Database["public"]["Enums"]["account_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          currency?: string
          id?: string
          initial_balance?: number
          institution?: string | null
          is_archived?: boolean
          name: string
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          currency?: string
          id?: string
          initial_balance?: number
          institution?: string | null
          is_archived?: boolean
          name?: string
          type?: Database["public"]["Enums"]["account_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      budgets: {
        Row: {
          amount_usd: number
          category_id: string
          created_at: string
          id: string
          month: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_usd: number
          category_id: string
          created_at?: string
          id?: string
          month: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_usd?: number
          category_id?: string
          created_at?: string
          id?: string
          month?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          is_income: boolean
          is_transfer: boolean
          name: string
          parent_id: string | null
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_income?: boolean
          is_transfer?: boolean
          name: string
          parent_id?: string | null
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_income?: boolean
          is_transfer?: boolean
          name?: string
          parent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          base: string
          created_at: string
          date: string
          quote: string
          rate: number
        }
        Insert: {
          base: string
          created_at?: string
          date: string
          quote: string
          rate: number
        }
        Update: {
          base?: string
          created_at?: string
          date?: string
          quote?: string
          rate?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          default_currency: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      recurrences: {
        Row: {
          account_id: string | null
          amount_usd: number
          cadence: string
          category_id: string | null
          created_at: string
          day_of_month: number | null
          id: string
          is_active: boolean
          is_income: boolean
          merchant_pattern: string | null
          name: string
          next_date: string
          notes: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount_usd: number
          cadence: string
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          id?: string
          is_active?: boolean
          is_income?: boolean
          merchant_pattern?: string | null
          name: string
          next_date: string
          notes?: string | null
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount_usd?: number
          cadence?: string
          category_id?: string | null
          created_at?: string
          day_of_month?: number | null
          id?: string
          is_active?: boolean
          is_income?: boolean
          merchant_pattern?: string | null
          name?: string
          next_date?: string
          notes?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number
          amount_usd: number
          category_id: string | null
          created_at: string
          currency: string
          date: string
          exchange_rate: number | null
          external_id: string | null
          id: string
          is_pending: boolean
          is_transfer: boolean
          merchant: string
          notes: string | null
          original_statement: string | null
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          amount_usd: number
          category_id?: string | null
          created_at?: string
          currency?: string
          date: string
          exchange_rate?: number | null
          external_id?: string | null
          id?: string
          is_pending?: boolean
          is_transfer?: boolean
          merchant: string
          notes?: string | null
          original_statement?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number
          amount_usd?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          date?: string
          exchange_rate?: number | null
          external_id?: string | null
          id?: string
          is_pending?: boolean
          is_transfer?: boolean
          merchant?: string
          notes?: string | null
          original_statement?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_type:
        | "checking"
        | "savings"
        | "credit_card"
        | "cash"
        | "investment"
        | "other"
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
      account_type: [
        "checking",
        "savings",
        "credit_card",
        "cash",
        "investment",
        "other",
      ],
    },
  },
} as const
