import { notFound } from "next/navigation"
import { OrderHistoryDetailView } from "@/components/staff/order-history-detail"
import { createClient } from "@/lib/supabase/server"
import { getOrderHistoryDetail } from "@/lib/supabase/order-history"

export default async function OrderHistoryDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}) {
  const { orderId } = await params
  const supabase = await createClient()
  const order = await getOrderHistoryDetail(supabase, orderId)
  if (!order) notFound()

  return (
    <div className="h-full overflow-y-auto">
      <OrderHistoryDetailView order={order} />
    </div>
  )
}
