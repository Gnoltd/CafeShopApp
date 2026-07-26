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
      categories: {
        Row: {
          id: string
          name_en: string
          name_vi: string
          sort_order: number
        }
        Insert: {
          id?: string
          name_en: string
          name_vi: string
          sort_order?: number
        }
        Update: {
          id?: string
          name_en?: string
          name_vi?: string
          sort_order?: number
        }
        Relationships: []
      }
      customer_addresses: {
        Row: {
          address: string
          created_at: string
          customer_id: string
          id: string
          is_default: boolean
          label: string
          phone: string
        }
        Insert: {
          address: string
          created_at?: string
          customer_id: string
          id?: string
          is_default?: boolean
          label: string
          phone?: string
        }
        Update: {
          address?: string
          created_at?: string
          customer_id?: string
          id?: string
          is_default?: boolean
          label?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          icon: Database["public"]["Enums"]["ingredient_icon"]
          id: string
          low_stock_threshold: number
          name_en: string
          name_vi: string
          stock_quantity: number
          subtitle_en: string
          subtitle_vi: string
          unit: string
        }
        Insert: {
          icon?: Database["public"]["Enums"]["ingredient_icon"]
          id?: string
          low_stock_threshold?: number
          name_en: string
          name_vi: string
          stock_quantity?: number
          subtitle_en: string
          subtitle_vi: string
          unit: string
        }
        Update: {
          icon?: Database["public"]["Enums"]["ingredient_icon"]
          id?: string
          low_stock_threshold?: number
          name_en?: string
          name_vi?: string
          stock_quantity?: number
          subtitle_en?: string
          subtitle_vi?: string
          unit?: string
        }
        Relationships: []
      }
      inventory_logs: {
        Row: {
          change_quantity: number
          created_at: string
          created_by: string | null
          id: string
          ingredient_id: string
          reason: Database["public"]["Enums"]["inventory_log_reason"]
          reference_order_id: string | null
        }
        Insert: {
          change_quantity: number
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id: string
          reason: Database["public"]["Enums"]["inventory_log_reason"]
          reference_order_id?: string | null
        }
        Update: {
          change_quantity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          ingredient_id?: string
          reason?: Database["public"]["Enums"]["inventory_log_reason"]
          reference_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_logs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_logs_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_logs_reference_order_id_fkey"
            columns: ["reference_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_settings: {
        Row: {
          earn_rate_vnd_per_point: number
          enabled: boolean
          id: number
          redeem_value_vnd_per_point: number
        }
        Insert: {
          earn_rate_vnd_per_point?: number
          enabled?: boolean
          id?: number
          redeem_value_vnd_per_point?: number
        }
        Update: {
          earn_rate_vnd_per_point?: number
          enabled?: boolean
          id?: number
          redeem_value_vnd_per_point?: number
        }
        Relationships: []
      }
      loyalty_tiers: {
        Row: {
          id: string
          min_points: number
          name_en: string
          name_vi: string
          sort_order: number
        }
        Insert: {
          id?: string
          min_points: number
          name_en: string
          name_vi: string
          sort_order?: number
        }
        Update: {
          id?: string
          min_points?: number
          name_en?: string
          name_vi?: string
          sort_order?: number
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          order_id: string | null
          points_change: number
          type: Database["public"]["Enums"]["loyalty_transaction_type"]
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          order_id?: string | null
          points_change: number
          type: Database["public"]["Enums"]["loyalty_transaction_type"]
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          order_id?: string | null
          points_change?: number
          type?: Database["public"]["Enums"]["loyalty_transaction_type"]
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_ingredients: {
        Row: {
          ingredient_id: string
          menu_item_id: string
          quantity_used: number
        }
        Insert: {
          ingredient_id: string
          menu_item_id: string
          quantity_used: number
        }
        Update: {
          ingredient_id?: string
          menu_item_id?: string
          quantity_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_ingredients_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_modifier_groups: {
        Row: {
          menu_item_id: string
          modifier_group_id: string
        }
        Insert: {
          menu_item_id: string
          modifier_group_id: string
        }
        Update: {
          menu_item_id?: string
          modifier_group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_modifier_groups_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_modifier_groups_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_reviews: {
        Row: {
          comment: string
          created_at: string
          customer_id: string
          id: string
          menu_item_id: string
          rating: number
          replied_by: string | null
          staff_reply: string | null
          staff_reply_at: string | null
          updated_at: string
        }
        Insert: {
          comment: string
          created_at?: string
          customer_id: string
          id?: string
          menu_item_id: string
          rating: number
          replied_by?: string | null
          staff_reply?: string | null
          staff_reply_at?: string | null
          updated_at?: string
        }
        Update: {
          comment?: string
          created_at?: string
          customer_id?: string
          id?: string
          menu_item_id?: string
          rating?: number
          replied_by?: string | null
          staff_reply?: string | null
          staff_reply_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_reviews_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_reviews_replied_by_fkey"
            columns: ["replied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_sizes: {
        Row: {
          id: string
          menu_item_id: string
          name: string
          price_delta: number
          sort_order: number
        }
        Insert: {
          id?: string
          menu_item_id: string
          name: string
          price_delta?: number
          sort_order?: number
        }
        Update: {
          id?: string
          menu_item_id?: string
          name?: string
          price_delta?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_sizes_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          base_price: number
          category_id: string
          created_at: string
          description_en: string
          description_vi: string
          has_size_options: boolean
          icon: string
          id: string
          image_url: string | null
          is_available: boolean
          is_popular: boolean
          name_en: string
          name_vi: string
        }
        Insert: {
          base_price: number
          category_id: string
          created_at?: string
          description_en: string
          description_vi: string
          has_size_options?: boolean
          icon?: string
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_popular?: boolean
          name_en: string
          name_vi: string
        }
        Update: {
          base_price?: number
          category_id?: string
          created_at?: string
          description_en?: string
          description_vi?: string
          has_size_options?: boolean
          icon?: string
          id?: string
          image_url?: string | null
          is_available?: boolean
          is_popular?: boolean
          name_en?: string
          name_vi?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          id: string
          is_required: boolean
          max_selections: number
          name_en: string
          name_vi: string
        }
        Insert: {
          id?: string
          is_required?: boolean
          max_selections?: number
          name_en: string
          name_vi: string
        }
        Update: {
          id?: string
          is_required?: boolean
          max_selections?: number
          name_en?: string
          name_vi?: string
        }
        Relationships: []
      }
      modifier_ingredients: {
        Row: {
          ingredient_id: string
          modifier_id: string
          quantity_used: number
        }
        Insert: {
          ingredient_id: string
          modifier_id: string
          quantity_used: number
        }
        Update: {
          ingredient_id?: string
          modifier_id?: string
          quantity_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifier_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_ingredients_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          id: string
          modifier_group_id: string
          name_en: string
          name_vi: string
          price_delta: number
        }
        Insert: {
          id?: string
          modifier_group_id: string
          name_en: string
          name_vi: string
          price_delta?: number
        }
        Update: {
          id?: string
          modifier_group_id?: string
          name_en?: string
          name_vi?: string
          price_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          modifier_id: string
          order_item_id: string
          price_delta: number
        }
        Insert: {
          modifier_id: string
          order_item_id: string
          price_delta: number
        }
        Update: {
          modifier_id?: string
          order_item_id?: string
          price_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          menu_item_id: string
          note: string | null
          order_id: string
          quantity: number
          size_id: string | null
          subtotal: number
          unit_price: number
        }
        Insert: {
          id?: string
          menu_item_id: string
          note?: string | null
          order_id: string
          quantity?: number
          size_id?: string | null
          subtotal: number
          unit_price: number
        }
        Update: {
          id?: string
          menu_item_id?: string
          note?: string | null
          order_id?: string
          quantity?: number
          size_id?: string | null
          subtotal?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_size_id_fkey"
            columns: ["size_id"]
            isOneToOne: false
            referencedRelation: "menu_item_sizes"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          customer_id: string | null
          discount_amount: number
          id: string
          loyalty_points_earned: number
          loyalty_points_used: number
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          pickup_time: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_id: string | null
          tax_amount: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          id?: string
          loyalty_points_earned?: number
          loyalty_points_used?: number
          order_type: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_time?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          table_id?: string | null
          tax_amount?: number
          total: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          id?: string
          loyalty_points_earned?: number
          loyalty_points_used?: number
          order_type?: Database["public"]["Enums"]["order_type"]
          paid_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          pickup_time?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          table_id?: string | null
          tax_amount?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string
          id: string
          order_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_transaction_id: string | null
          raw_response: Json | null
          status: Database["public"]["Enums"]["transaction_status"]
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          order_id: string
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_transaction_id?: string | null
          raw_response?: Json | null
          status?: Database["public"]["Enums"]["transaction_status"]
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          order_id?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_transaction_id?: string | null
          raw_response?: Json | null
          status?: Database["public"]["Enums"]["transaction_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          is_active: boolean
          loyalty_points_balance: number
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          is_active?: boolean
          loyalty_points_balance?: number
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          loyalty_points_balance?: number
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      reward_redemptions: {
        Row: {
          applied_order_id: string | null
          customer_id: string
          fulfilled_at: string | null
          id: string
          points_spent: number
          redeemed_at: string
          reward_id: string
        }
        Insert: {
          applied_order_id?: string | null
          customer_id: string
          fulfilled_at?: string | null
          id?: string
          points_spent: number
          redeemed_at?: string
          reward_id: string
        }
        Update: {
          applied_order_id?: string | null
          customer_id?: string
          fulfilled_at?: string | null
          id?: string
          points_spent?: number
          redeemed_at?: string
          reward_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_redemptions_applied_order_id_fkey"
            columns: ["applied_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reward_redemptions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards: {
        Row: {
          active: boolean
          created_at: string
          description_en: string
          description_vi: string
          discount_value_vnd: number
          id: string
          name_en: string
          name_vi: string
          points_cost: number
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description_en?: string
          description_vi?: string
          discount_value_vnd?: number
          id?: string
          name_en: string
          name_vi: string
          points_cost: number
          sort_order?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description_en?: string
          description_vi?: string
          discount_value_vnd?: number
          id?: string
          name_en?: string
          name_vi?: string
          points_cost?: number
          sort_order?: number
        }
        Relationships: []
      }
      shift_workers: {
        Row: {
          id: string
          joined_at: string
          left_at: string | null
          shift_id: string
          staff_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          left_at?: string | null
          shift_id: string
          staff_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          left_at?: string | null
          shift_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_workers_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_workers_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          counted_cash: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string
          planned_end_at: string | null
          planned_start_at: string | null
          starting_cash: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by: string
          planned_end_at?: string | null
          planned_start_at?: string | null
          starting_cash: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          counted_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string
          planned_end_at?: string | null
          planned_start_at?: string | null
          starting_cash?: number
        }
        Relationships: [
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_settings: {
        Row: {
          address: string | null
          id: number
          landing_hero_base_images: string[]
          landing_hero_reveal_image: string | null
          opening_hours: string | null
          phone: string | null
          shop_name: string
          tax_rate: number
        }
        Insert: {
          address?: string | null
          id?: number
          landing_hero_base_images?: string[]
          landing_hero_reveal_image?: string | null
          opening_hours?: string | null
          phone?: string | null
          shop_name?: string
          tax_rate?: number
        }
        Update: {
          address?: string | null
          id?: number
          landing_hero_base_images?: string[]
          landing_hero_reveal_image?: string | null
          opening_hours?: string | null
          phone?: string | null
          shop_name?: string
          tax_rate?: number
        }
        Relationships: []
      }
      tables: {
        Row: {
          cleaning_notified_at: string | null
          id: string
          location_en: string
          location_vi: string
          qr_code_token: string
          scan_count: number
          status: Database["public"]["Enums"]["table_occupancy_status"]
          table_number: string
        }
        Insert: {
          cleaning_notified_at?: string | null
          id?: string
          location_en?: string
          location_vi?: string
          qr_code_token?: string
          scan_count?: number
          status?: Database["public"]["Enums"]["table_occupancy_status"]
          table_number: string
        }
        Update: {
          cleaning_notified_at?: string | null
          id?: string
          location_en?: string
          location_vi?: string
          qr_code_token?: string
          scan_count?: number
          status?: Database["public"]["Enums"]["table_occupancy_status"]
          table_number?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_ingredient_stock: {
        Args: {
          p_change: number
          p_ingredient_id: string
          p_reason: Database["public"]["Enums"]["inventory_log_reason"]
        }
        Returns: {
          icon: Database["public"]["Enums"]["ingredient_icon"]
          id: string
          low_stock_threshold: number
          name_en: string
          name_vi: string
          stock_quantity: number
          subtitle_en: string
          subtitle_vi: string
          unit: string
        }
        SetofOptions: {
          from: "*"
          to: "ingredients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_pending_order: { Args: { p_order_id: string }; Returns: boolean }
      change_order_payment_method: {
        Args: {
          p_method?: Database["public"]["Enums"]["payment_method"]
          p_order_id: string
        }
        Returns: boolean
      }
      close_shift: {
        Args: { p_counted_cash: number; p_notes?: string }
        Returns: Json
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      find_redemption_by_code: {
        Args: { p_code: string }
        Returns: {
          applied_order_id: string
          customer_name: string
          fulfilled_at: string
          id: string
          points_spent: number
          redeemed_at: string
          reward_name_en: string
          reward_name_vi: string
        }[]
      }
      fulfill_redemption: { Args: { p_redemption_id: string }; Returns: string }
      get_dashboard_stats: { Args: never; Returns: Json }
      get_menu_item_reviews: { Args: { p_item_id: string }; Returns: Json }
      get_my_loyalty_tier_progress: {
        Args: never
        Returns: {
          current_tier_name_en: string
          current_tier_name_vi: string
          lifetime_points: number
          next_tier_name_en: string
          next_tier_name_vi: string
          points_to_next: number
          progress_percent: number
        }[]
      }
      get_my_redemptions: {
        Args: never
        Returns: {
          applied_order_id: string
          discount_value_vnd: number
          expires_at: string
          fulfilled_at: string
          id: string
          is_expired: boolean
          is_used: boolean
          points_spent: number
          redeemed_at: string
          reward_name_en: string
          reward_name_vi: string
        }[]
      }
      get_order_for_tracking: { Args: { p_order_id: string }; Returns: Json }
      get_order_history: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_order_type?: Database["public"]["Enums"]["order_type"]
          p_search?: string
          p_statuses?: Database["public"]["Enums"]["order_status"][]
        }
        Returns: Json
      }
      get_redemption_expiry: {
        Args: { p_redemption_id: string }
        Returns: string
      }
      get_shift_history: { Args: never; Returns: Json }
      get_shift_report: { Args: { p_shift_id?: string }; Returns: Json }
      get_staff_members: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
          is_active: boolean
          phone: string
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      get_table_by_qr_token: {
        Args: { p_token: string }
        Returns: {
          cleaning_notified_at: string | null
          id: string
          location_en: string
          location_vi: string
          qr_code_token: string
          scan_count: number
          status: Database["public"]["Enums"]["table_occupancy_status"]
          table_number: string
        }
        SetofOptions: {
          from: "*"
          to: "tables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_tables_admin: {
        Args: never
        Returns: {
          cleaning_notified_at: string | null
          id: string
          location_en: string
          location_vi: string
          qr_code_token: string
          scan_count: number
          status: Database["public"]["Enums"]["table_occupancy_status"]
          table_number: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tables"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      increment_table_scan_count: {
        Args: { p_table_id: string }
        Returns: {
          cleaning_notified_at: string | null
          id: string
          location_en: string
          location_vi: string
          qr_code_token: string
          scan_count: number
          status: Database["public"]["Enums"]["table_occupancy_status"]
          table_number: string
        }
        SetofOptions: {
          from: "*"
          to: "tables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_shift_open: { Args: never; Returns: boolean }
      join_shift: { Args: never; Returns: Json }
      leave_shift: { Args: never; Returns: Json }
      notify_table_cleaning: {
        Args: { p_table_id: string }
        Returns: {
          cleaning_notified_at: string | null
          id: string
          location_en: string
          location_vi: string
          qr_code_token: string
          scan_count: number
          status: Database["public"]["Enums"]["table_occupancy_status"]
          table_number: string
        }
        SetofOptions: {
          from: "*"
          to: "tables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_shift: {
        Args: {
          p_planned_end_at?: string
          p_planned_start_at?: string
          p_starting_cash: number
        }
        Returns: Json
      }
      place_order: { Args: { p_payload: Json }; Returns: Json }
      redeem_reward: { Args: { p_reward_id: string }; Returns: string }
      regenerate_table_qr_token: {
        Args: { p_table_id: string }
        Returns: {
          cleaning_notified_at: string | null
          id: string
          location_en: string
          location_vi: string
          qr_code_token: string
          scan_count: number
          status: Database["public"]["Enums"]["table_occupancy_status"]
          table_number: string
        }
        SetofOptions: {
          from: "*"
          to: "tables"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reply_to_review: {
        Args: { p_reply: string; p_review_id: string }
        Returns: undefined
      }
      set_default_address: {
        Args: { p_address_id: string }
        Returns: undefined
      }
      set_initial_staff_role: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      submit_menu_item_review: {
        Args: { p_comment: string; p_item_id: string; p_rating: number }
        Returns: undefined
      }
    }
    Enums: {
      ingredient_icon: "coffee" | "droplet" | "wheat" | "candy"
      inventory_log_reason:
        | "order_deduction"
        | "restock"
        | "adjustment"
        | "waste"
      loyalty_transaction_type: "earn" | "redeem" | "adjust"
      order_status:
        | "pending_payment"
        | "paid"
        | "preparing"
        | "ready"
        | "served"
        | "completed"
        | "cancelled"
      order_type: "pickup" | "dine_in"
      payment_method: "stripe" | "cash" | "vnpay"
      payment_provider: "stripe" | "vnpay" | "cash"
      payment_status: "pending" | "paid" | "failed" | "refunded"
      table_occupancy_status: "available" | "occupied" | "cleaning"
      transaction_status: "pending" | "succeeded" | "failed"
      user_role: "customer" | "staff" | "manager" | "admin"
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
      ingredient_icon: ["coffee", "droplet", "wheat", "candy"],
      inventory_log_reason: [
        "order_deduction",
        "restock",
        "adjustment",
        "waste",
      ],
      loyalty_transaction_type: ["earn", "redeem", "adjust"],
      order_status: [
        "pending_payment",
        "paid",
        "preparing",
        "ready",
        "served",
        "completed",
        "cancelled",
      ],
      order_type: ["pickup", "dine_in"],
      payment_method: ["stripe", "cash", "vnpay"],
      payment_provider: ["stripe", "vnpay", "cash"],
      payment_status: ["pending", "paid", "failed", "refunded"],
      table_occupancy_status: ["available", "occupied", "cleaning"],
      transaction_status: ["pending", "succeeded", "failed"],
      user_role: ["customer", "staff", "manager", "admin"],
    },
  },
} as const
