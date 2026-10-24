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
      comments: {
        Row: {
          body: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_hidden: boolean;
          post_id: string;
          report_count: number;
          request_id: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_hidden?: boolean;
          post_id: string;
          report_count?: number;
          request_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_hidden?: boolean;
          post_id?: string;
          report_count?: number;
          request_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'comments_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'comments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      community_moderation_log: {
        Row: {
          action: string;
          actor_id: string;
          created_at: string;
          id: string;
          reason: string;
          target_id: string;
          target_type: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id: string;
          created_at?: string;
          id?: string;
          reason: string;
          target_id: string;
          target_type: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          created_at?: string;
          id?: string;
          reason?: string;
          target_id?: string;
          target_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'community_moderation_log_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      message_media: {
        Row: {
          bucket_id: string;
          byte_size: number;
          duration_ms: number | null;
          height: number | null;
          id: string;
          kind: Database['public']['Enums']['message_type'];
          message_id: string;
          mime_type: string;
          object_path: string;
          storage_object_id: string;
          verified_at: string;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          bucket_id: string;
          byte_size: number;
          duration_ms?: number | null;
          height?: number | null;
          id: string;
          kind: Database['public']['Enums']['message_type'];
          message_id: string;
          mime_type: string;
          object_path: string;
          storage_object_id: string;
          verified_at?: string;
          width?: number | null;
        };
        Update: {
          bucket_id?: string;
          byte_size?: number;
          duration_ms?: number | null;
          height?: number | null;
          id?: string;
          kind?: Database['public']['Enums']['message_type'];
          message_id?: string;
          mime_type?: string;
          object_path?: string;
          storage_object_id?: string;
          verified_at?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'message_media_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
        ];
      };
      message_reads: {
        Row: {
          message_id: string;
          read_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          message_id: string;
          read_at?: string;
          user_id: string;
        };
        Update: {
          message_id?: string;
          read_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'message_reads_message_id_fkey';
            columns: ['message_id'];
            isOneToOne: false;
            referencedRelation: 'messages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'message_reads_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      messages: {
        Row: {
          artist_id: string;
          author_id: string;
          body: string | null;
          canceled_at: string | null;
          created_at: string;
          id: string;
          is_preview: boolean;
          preview_order: number | null;
          scheduled_at: string | null;
          sent_at: string | null;
          status: Database['public']['Enums']['message_status'];
          type: Database['public']['Enums']['message_type'];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          artist_id: string;
          author_id: string;
          body?: string | null;
          canceled_at?: string | null;
          created_at?: string;
          id?: string;
          is_preview?: boolean;
          preview_order?: number | null;
          scheduled_at?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['message_status'];
          type: Database['public']['Enums']['message_type'];
          updated_at?: string;
        };
        Update: {
          artist_id?: string;
          author_id?: string;
          body?: string | null;
          canceled_at?: string | null;
          created_at?: string;
          id?: string;
          is_preview?: boolean;
          preview_order?: number | null;
          scheduled_at?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['message_status'];
          type?: Database['public']['Enums']['message_type'];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artist_catalog';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'messages_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
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
      post_images: {
        Row: {
          bucket_id: string;
          byte_size: number;
          created_at: string;
          height: number;
          id: string;
          mime_type: string;
          object_path: string;
          post_id: string;
          storage_object_id: string;
          width: number;
        };
        ComputedFields: never;
        Insert: {
          bucket_id: string;
          byte_size: number;
          created_at?: string;
          height: number;
          id: string;
          mime_type: string;
          object_path: string;
          post_id: string;
          storage_object_id: string;
          width: number;
        };
        Update: {
          bucket_id?: string;
          byte_size?: number;
          created_at?: string;
          height?: number;
          id?: string;
          mime_type?: string;
          object_path?: string;
          post_id?: string;
          storage_object_id?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'post_images_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
        ];
      };
      post_likes: {
        Row: {
          created_at: string;
          post_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          post_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          post_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'post_likes_post_id_fkey';
            columns: ['post_id'];
            isOneToOne: false;
            referencedRelation: 'posts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'post_likes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      posts: {
        Row: {
          artist_id: string;
          body: string;
          comment_count: number;
          created_at: string;
          deleted_at: string | null;
          id: string;
          is_hidden: boolean;
          is_notice: boolean;
          is_pinned: boolean;
          like_count: number;
          report_count: number;
          request_id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          artist_id: string;
          body: string;
          comment_count?: number;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_hidden?: boolean;
          is_notice?: boolean;
          is_pinned?: boolean;
          like_count?: number;
          report_count?: number;
          request_id: string;
          title: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          artist_id?: string;
          body?: string;
          comment_count?: number;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          is_hidden?: boolean;
          is_notice?: boolean;
          is_pinned?: boolean;
          like_count?: number;
          report_count?: number;
          request_id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'posts_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artist_catalog';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'posts_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'posts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
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
      replies: {
        Row: {
          artist_id: string;
          body: string;
          created_at: string;
          id: string;
          is_blocked: boolean;
          subscription_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          artist_id: string;
          body: string;
          created_at?: string;
          id?: string;
          is_blocked?: boolean;
          subscription_id: string;
          user_id: string;
        };
        Update: {
          artist_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          is_blocked?: boolean;
          subscription_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'replies_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artist_catalog';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'replies_artist_id_fkey';
            columns: ['artist_id'];
            isOneToOne: false;
            referencedRelation: 'artists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'replies_subscription_id_fkey';
            columns: ['subscription_id'];
            isOneToOne: false;
            referencedRelation: 'subscriptions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'replies_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      reports: {
        Row: {
          created_at: string;
          id: string;
          reason: string;
          reporter_id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          status: Database['public']['Enums']['report_status'];
          target_id: string;
          target_type: Database['public']['Enums']['report_target'];
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          reason: string;
          reporter_id: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database['public']['Enums']['report_status'];
          target_id: string;
          target_type: Database['public']['Enums']['report_target'];
        };
        Update: {
          created_at?: string;
          id?: string;
          reason?: string;
          reporter_id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database['public']['Enums']['report_status'];
          target_id?: string;
          target_type?: Database['public']['Enums']['report_target'];
        };
        Relationships: [
          {
            foreignKeyName: 'reports_reporter_id_fkey';
            columns: ['reporter_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reports_resolved_by_fkey';
            columns: ['resolved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
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
      community_create_comment: {
        Args: { p_body: string; p_post_id: string; p_request_id: string };
        Returns: string;
      };
      community_create_post: {
        Args: {
          p_artist_id: string;
          p_body: string;
          p_request_id: string;
          p_title: string;
        };
        Returns: string;
      };
      community_delete: {
        Args: {
          p_target_id: string;
          p_target_type: Database['public']['Enums']['report_target'];
        };
        Returns: undefined;
      };
      community_moderate: {
        Args: {
          p_decision: string;
          p_reason: string;
          p_target_id: string;
          p_target_type: Database['public']['Enums']['report_target'];
        };
        Returns: undefined;
      };
      community_register_image: {
        Args: {
          p_actor_id: string;
          p_height: number;
          p_image_id: string;
          p_post_id: string;
          p_storage_object_id: string;
          p_width: number;
        };
        Returns: string;
      };
      community_report: {
        Args: {
          p_reason: string;
          p_target_id: string;
          p_target_type: Database['public']['Enums']['report_target'];
        };
        Returns: string;
      };
      community_restrict_user: {
        Args: {
          p_reason: string;
          p_restricted: boolean;
          p_until: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      community_set_like: {
        Args: { p_liked: boolean; p_post_id: string };
        Returns: boolean;
      };
      community_set_notice: {
        Args: { p_is_notice: boolean; p_is_pinned: boolean; p_post_id: string };
        Returns: undefined;
      };
      community_update_comment: {
        Args: { p_body: string; p_comment_id: string };
        Returns: undefined;
      };
      community_update_post: {
        Args: { p_body: string; p_post_id: string; p_title: string };
        Returns: undefined;
      };
      has_active_access: { Args: { p_artist_id: string }; Returns: boolean };
      mark_message_read: { Args: { p_message_id: string }; Returns: string };
      messaging_cancel: {
        Args: { p_actor_id: string; p_message_id: string };
        Returns: undefined;
      };
      messaging_create_reply: {
        Args: { p_actor_id: string; p_artist_id: string; p_body: string };
        Returns: string;
      };
      messaging_dispatch: { Args: { p_message_id: string }; Returns: boolean };
      messaging_list_messages: {
        Args: {
          p_actor_id: string;
          p_artist_id: string;
          p_before_id?: string;
          p_before_sent_at?: string;
          p_limit: number;
          p_preview: boolean;
        };
        Returns: {
          artist_id: string;
          body_template: string;
          id: string;
          media: Json;
          sent_at: string;
          type: Database['public']['Enums']['message_type'];
        }[];
      };
      messaging_list_replies: {
        Args: {
          p_actor_id: string;
          p_artist_id: string;
          p_before_created_at?: string;
          p_before_id?: string;
          p_limit: number;
        };
        Returns: {
          body: string;
          call_name: string;
          created_at: string;
          id: string;
        }[];
      };
      messaging_register_media: {
        Args: {
          p_actor_id: string;
          p_duration_ms: number;
          p_height: number;
          p_media_id: string;
          p_message_id: string;
          p_storage_object_id: string;
          p_width: number;
        };
        Returns: string;
      };
      messaging_save_draft: {
        Args: {
          p_actor_id: string;
          p_artist_id: string;
          p_body: string;
          p_message_id: string;
          p_type: Database['public']['Enums']['message_type'];
        };
        Returns: string;
      };
      messaging_schedule: {
        Args: {
          p_actor_id: string;
          p_message_id: string;
          p_scheduled_at: string;
        };
        Returns: undefined;
      };
      messaging_set_previews: {
        Args: {
          p_actor_id: string;
          p_artist_id: string;
          p_message_ids: string[];
        };
        Returns: undefined;
      };
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
      message_status: 'draft' | 'scheduled' | 'sent' | 'canceled';
      message_type: 'text' | 'photo' | 'voice' | 'video';
      payment_event_kind: 'charge' | 'refund';
      payment_provider: 'toss' | 'kakaopay';
      report_status: 'open' | 'hidden' | 'restored' | 'deleted';
      report_target: 'post' | 'comment' | 'reply';
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
      message_status: ['draft', 'scheduled', 'sent', 'canceled'],
      message_type: ['text', 'photo', 'voice', 'video'],
      payment_event_kind: ['charge', 'refund'],
      payment_provider: ['toss', 'kakaopay'],
      report_status: ['open', 'hidden', 'restored', 'deleted'],
      report_target: ['post', 'comment', 'reply'],
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
