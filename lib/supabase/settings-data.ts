import type { SupabaseClient } from "@supabase/supabase-js"

export type ShopSettings = {
  shopName: string
  address: string
  phone: string
  openingHours: string
}

export type ShopSettingsInput = {
  shopName: string
  address: string
  phone: string
  openingHours: string
}

type ShopSettingsRow = {
  shop_name: string
  address: string | null
  phone: string | null
  opening_hours: string | null
}

export async function getShopSettings(supabase: SupabaseClient): Promise<ShopSettings> {
  const { data, error } = await supabase
    .from("shop_settings")
    .select("shop_name, address, phone, opening_hours")
    .eq("id", 1)
    .single()
  if (error) throw error
  const row = data as ShopSettingsRow
  return {
    shopName: row.shop_name,
    address: row.address ?? "",
    phone: row.phone ?? "",
    openingHours: row.opening_hours ?? "",
  }
}

export async function updateShopSettings(supabase: SupabaseClient, input: ShopSettingsInput): Promise<void> {
  const { error } = await supabase
    .from("shop_settings")
    .update({
      shop_name: input.shopName,
      address: input.address,
      phone: input.phone,
      opening_hours: input.openingHours,
    })
    .eq("id", 1)
  if (error) throw error
}
