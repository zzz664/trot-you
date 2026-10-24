export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      artist_members: {
        Row: {
          artist_id: string;
          is_manager: boolean;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          artist_id: string;
          is_manager?: boolean;
          user_id: string;
        };
        Update: {
          artist_id?: string;
          is_manager?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'artist_members_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artist_catalog';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'artist_members_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'artist_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      artists: {
        Row: {
          agency_name: string | null;
          contract_ended_at: string | null;
          contract_started_at: string | null;
          created_at: string;
          grade: Database['public']['Enums']['artist_grade'];
          id: string;
          intro: string | null;
          name: string;
          profile_image_path: string | null;
          slug: string;
          status: Database['public']['Enums']['artist_status'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          agency_name?: string | null;
          contract_ended_at?: string | null;
          contract_started_at?: string | null;
          created_at?: string;
          grade: Database['public']['Enums']['artist_grade'];
          id?: string;
          intro?: string | null;
          name: string;
          profile_image_path?: string | null;
          slug: string;
          status?: Database['public']['Enums']['artist_status'];
          updated_at?: string;
        };
        Update: {
          agency_name?: string | null;
          contract_ended_at?: string | null;
          contract_started_at?: string | null;
          created_at?: string;
          grade?: Database['public']['Enums']['artist_grade'];
          id?: string;
          intro?: string | null;
          name?: string;
          profile_image_path?: string | null;
          slug?: string;
          status?: Database['public']['Enums']['artist_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_events: {
        Row: {
          amount_krw: number;
          currency: string;
          id: string;
          kind: Database['public']['Enums']['payment_event_kind'];
          occurred_at: string;
          original_event_id: string | null;
          period_end: string;
          period_start: string;
          provider: Database['public']['Enums']['payment_provider'];
          recorded_at: string;
          subscription_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount_krw: number;
          currency?: string;
          id?: string;
          kind: Database['public']['Enums']['payment_event_kind'];
          occurred_at: string;
          original_event_id?: string | null;
          period_end: string;
          period_start: string;
          provider: Database['public']['Enums']['payment_provider'];
          recorded_at?: string;
          subscription_id: string;
        };
        Update: {
          amount_krw?: number;
          currency?: string;
          id?: string;
          kind?: Database['public']['Enums']['payment_event_kind'];
          occurred_at?: string;
          original_event_id?: string | null;
          period_end?: string;
          period_start?: string;
          provider?: Database['public']['Enums']['payment_provider'];
          recorded_at?: string;
          subscription_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_events_original_event_id_fkey';
            columns: ['original_event_id'];
            isOneToOne: false;
            referencedRelation: 'payment_events';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_events_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          age_range: string | null;
          call_name: string | null;
          created_at: string;
          font_scale: Database['public']['Enums']['font_scale'];
          gender: string | null;
          id: string;
          is_restricted: boolean;
          kakao_channel_added: boolean;
          nickname: string | null;
          onboarding_completed_at: string | null;
          phone: string | null;
          restricted_until: string | null;
          role: Database['public']['Enums']['user_role'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          age_range?: string | null;
          call_name?: string | null;
          created_at?: string;
          font_scale?: Database['public']['Enums']['font_scale'];
          gender?: string | null;
          id: string;
          is_restricted?: boolean;
          kakao_channel_added?: boolean;
          nickname?: string | null;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          restricted_until?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Update: {
          age_range?: string | null;
          call_name?: string | null;
          created_at?: string;
          font_scale?: Database['public']['Enums']['font_scale'];
          gender?: string | null;
          id?: string;
          is_restricted?: boolean;
          kakao_channel_added?: boolean;
          nickname?: string | null;
          onboarding_completed_at?: string | null;
          phone?: string | null;
          restricted_until?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Relationships: [];
      };
      subscriptions: {
        Row: {
          artist_id: string;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          episode_started_at: string | null;
          first_started_at: string | null;
          grace_ends_at: string | null;
          grace_started_at: string | null;
          id: string;
          intro_redeemed_at: string | null;
          next_billing_at: string | null;
          provider: Database['public']['Enums']['payment_provider'];
          status: Database['public']['Enums']['subscription_status'];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          artist_id: string;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          episode_started_at?: string | null;
          first_started_at?: string | null;
          grace_ends_at?: string | null;
          grace_started_at?: string | null;
          id?: string;
          intro_redeemed_at?: string | null;
          next_billing_at?: string | null;
          provider: Database['public']['Enums']['payment_provider'];
          status?: Database['public']['Enums']['subscription_status'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          artist_id?: string;
          canceled_at?: string | null;
          created_at?: string;
          current_period_end?: string | null;
          current_period_start?: string | null;
          episode_started_at?: string | null;
          first_started_at?: string | null;
          grace_ends_at?: string | null;
          grace_started_at?: string | null;
          id?: string;
          intro_redeemed_at?: string | null;
          next_billing_at?: string | null;
          provider?: Database['public']['Enums']['payment_provider'];
          status?: Database['public']['Enums']['subscription_status'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subscriptions_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artist_catalog';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'subscriptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      artist_catalog: {
        Row: {
          id: string;
          intro: string | null;
          name: string;
          profile_image_path: string | null;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string | null;
          intro?: string | null;
          name?: string | null;
          profile_image_path?: string | null;
          slug?: string | null;
        };
        Update: {
          id?: string | null;
          intro?: string | null;
          name?: string | null;
          profile_image_path?: string | null;
          slug?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      billing_claim_attempt: {
        Args: { p_attempt_id: string; p_lease_seconds: number };
        Returns: Json;
      };
      billing_expire_subscription: {
        Args: { p_subscription_id: string };
        Returns: undefined;
      };
      billing_finalize_charge: {
        Args: {
          p_amount_krw: number;
          p_approved_at: string;
          p_attempt_id: string;
          p_currency: string;
          p_evidence_ref: string;
          p_provider_action_id: string;
        };
        Returns: string;
      };
      billing_open_subscription: {
        Args: {
          p_artist_id: string;
          p_provider: Database['public']['Enums']['payment_provider'];
          p_user_id: string;
        };
        Returns: string;
      };
      billing_prepare_attempt: {
        Args: { p_obligation_id: string };
        Returns: string;
      };
      billing_prepare_obligation: {
        Args: {
          p_amount_krw: number;
          p_grace_seconds: number;
          p_is_intro: boolean;
          p_max_retries: number;
          p_period_end: string;
          p_period_start: string;
          p_price_version: string;
          p_retry_seconds: number;
          p_subscription_id: string;
        };
        Returns: string;
      };
      billing_record_attempt_outcome: {
        Args: {
          p_attempt_id: string;
          p_evidence_ref: string;
          p_lease_token: string;
          p_outcome: string;
        };
        Returns: undefined;
      };
      billing_record_refund: {
        Args: {
          p_amount_krw: number;
          p_currency: string;
          p_evidence_ref: string;
          p_original_event_id: string;
          p_provider_action_id: string;
          p_refunded_at: string;
        };
        Returns: string;
      };
      billing_register_mandate: {
        Args: {
          p_consent_version: string;
          p_environment: string;
          p_merchant_account: string;
          p_provider_customer_ref: string;
          p_secure_credential_ref: string;
          p_subscription_id: string;
        };
        Returns: string;
      };
      cancel_subscription: {
        Args: { p_subscription_id: string };
        Returns: {
          artist_id: string;
          canceled_at: string | null;
          created_at: string;
          current_period_end: string | null;
          current_period_start: string | null;
          episode_started_at: string | null;
          first_started_at: string | null;
          grace_ends_at: string | null;
          grace_started_at: string | null;
          id: string;
          intro_redeemed_at: string | null;
          next_billing_at: string | null;
          provider: Database['public']['Enums']['payment_provider'];
          status: Database['public']['Enums']['subscription_status'];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'subscriptions';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      has_active_access: { Args: { p_artist_id: string }; Returns: boolean };
      set_profile_role: {
        Args: {
          p_role: Database['public']['Enums']['user_role'];
          p_user_id: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      artist_grade: 'B' | 'C';
      artist_status: 'draft' | 'active' | 'paused' | 'retired';
      font_scale: 'normal' | 'large' | 'xlarge';
      payment_event_kind: 'charge' | 'refund';
      payment_provider: 'toss' | 'kakaopay';
      subscription_status:
        'pending' | 'active' | 'grace' | 'canceled' | 'expired';
      user_role: 'fan' | 'artist' | 'admin';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      artist_grade: ['B', 'C'],
      artist_status: ['draft', 'active', 'paused', 'retired'],
      font_scale: ['normal', 'large', 'xlarge'],
      payment_event_kind: ['charge', 'refund'],
      payment_provider: ['toss', 'kakaopay'],
      subscription_status: [
        'pending',
        'active',
        'grace',
        'canceled',
        'expired',
      ],
      user_role: ['fan', 'artist', 'admin'],
    },
  },
} as const;
