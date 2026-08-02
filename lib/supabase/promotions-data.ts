import type { SupabaseClient } from "@supabase/supabase-js"

export type DiscountType = "percent" | "fixed"

export type Promotion = {
  id: string
  code: string
  discountType: DiscountType
  discountValue: number
  active: boolean
  startsAt: number | null
  endsAt: number | null
  maxRedemptions: number | null
  timesUsed: number
  minSubtotalVnd: number | null
}

export type PromotionInput = {
  code: string
  discountType: DiscountType
  discountValue: number
  active: boolean
  startsAt?: number | null
  endsAt?: number | null
  maxRedemptions?: number | null
  minSubtotalVnd?: number | null
}

type PromotionRow = {
  id: string
  code: string
  discount_type: DiscountType
  discount_value: number
  active: boolean
  starts_at: string | null
  ends_at: string | null
  max_redemptions: number | null
  times_used: number
  min_subtotal_vnd: number | null
}

const PROMOTION_SELECT =
  "id, code, discount_type, discount_value, active, starts_at, ends_at, max_redemptions, times_used, min_subtotal_vnd"

function mapPromotionRow(row: PromotionRow): Promotion {
  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    active: row.active,
    startsAt: row.starts_at ? new Date(row.starts_at).getTime() : null,
    endsAt: row.ends_at ? new Date(row.ends_at).getTime() : null,
    maxRedemptions: row.max_redemptions,
    timesUsed: row.times_used,
    minSubtotalVnd: row.min_subtotal_vnd,
  }
}

function toRow(input: PromotionInput) {
  return {
    code: input.code.trim().toUpperCase(),
    discount_type: input.discountType,
    discount_value: input.discountValue,
    active: input.active,
    starts_at: input.startsAt ? new Date(input.startsAt).toISOString() : null,
    ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    max_redemptions: input.maxRedemptions ?? null,
    min_subtotal_vnd: input.minSubtotalVnd ?? null,
  }
}

export async function getPromotions(supabase: SupabaseClient): Promise<Promotion[]> {
  const { data, error } = await supabase.from("promotions").select(PROMOTION_SELECT).order("created_at", { ascending: false })
  if (error) throw error
  return ((data ?? []) as PromotionRow[]).map(mapPromotionRow)
}

export async function createPromotion(supabase: SupabaseClient, input: PromotionInput): Promise<Promotion> {
  const { data, error } = await supabase.from("promotions").insert(toRow(input)).select(PROMOTION_SELECT).single()
  if (error) throw error
  return mapPromotionRow(data as PromotionRow)
}

export async function updatePromotion(supabase: SupabaseClient, id: string, input: PromotionInput): Promise<Promotion> {
  const { data, error } = await supabase.from("promotions").update(toRow(input)).eq("id", id).select(PROMOTION_SELECT).single()
  if (error) throw error
  return mapPromotionRow(data as PromotionRow)
}

export async function deletePromotion(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("promotions").delete().eq("id", id)
  if (error) throw error
}

export type PromoValidation =
  | { valid: true; discountType: DiscountType; discountValue: number; discountAmount: number }
  | { valid: false; reason: "not_found" | "inactive" | "not_started" | "expired" | "limit_reached" | "below_minimum" }

export async function validatePromoCode(supabase: SupabaseClient, code: string, subtotal: number): Promise<PromoValidation> {
  const { data, error } = await supabase.rpc("validate_promo_code", { p_code: code, p_subtotal: subtotal })
  if (error) throw error
  return data as PromoValidation
}
