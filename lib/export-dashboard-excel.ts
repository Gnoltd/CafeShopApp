import * as XLSX from "xlsx"
import type { DashboardStats } from "@/hooks/useDashboardStats"
import type { Ingredient } from "@/hooks/useInventory"
import { parseIsoDateLocal } from "@/lib/format"

export type DashboardExportInput = {
  stats: DashboardStats
  lowStock: Ingredient[]
  tableCounts: { available: number; occupied: number; cleaning: number }
  locale: string
}

const VND_FORMAT = '#,##0" đ"'

function applyNumberFormat(sheet: XLSX.WorkSheet, colIndex: number, rowCount: number, format: string): void {
  for (let r = 1; r <= rowCount; r++) {
    const cellRef = XLSX.utils.encode_cell({ r, c: colIndex })
    const cell = sheet[cellRef]
    if (cell) cell.z = format
  }
}

export function exportDashboardExcel(input: DashboardExportInput): void {
  const { stats, lowStock, tableCounts, locale } = input
  const localeTag = locale === "vi" ? "vi-VN" : "en-US"
  const workbook = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.json_to_sheet([
    { Metric: "Today's Revenue (VND)", Value: stats.todayRevenue },
    { Metric: "Orders Today", Value: stats.ordersToday },
    { Metric: "Loyalty Points Issued Today", Value: stats.loyaltyIssuedToday },
    { Metric: "Low Stock Alerts", Value: lowStock.length },
    { Metric: "Exported At", Value: new Date().toLocaleString(localeTag) },
  ])
  applyNumberFormat(summarySheet, 1, 1, VND_FORMAT)
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary")

  const revenueSheet = XLSX.utils.json_to_sheet(
    stats.sevenDayRevenue.map((day) => ({
      Date: day.date,
      Day: parseIsoDateLocal(day.date).toLocaleDateString(localeTag, { weekday: "short" }),
      "Revenue (VND)": day.revenue,
    }))
  )
  applyNumberFormat(revenueSheet, 2, stats.sevenDayRevenue.length, VND_FORMAT)
  XLSX.utils.book_append_sheet(workbook, revenueSheet, "7-Day Revenue")

  const bestSellersSheet = XLSX.utils.json_to_sheet(
    stats.bestSellers.map((item) => ({
      "Name (VI)": item.nameVi,
      "Name (EN)": item.nameEn,
      "Quantity Sold": item.quantitySold,
    }))
  )
  XLSX.utils.book_append_sheet(workbook, bestSellersSheet, "Best Sellers")

  const inventorySheet = XLSX.utils.json_to_sheet(
    lowStock.map((item) => ({
      "Product (VI)": item.nameVi,
      "Product (EN)": item.nameEn,
      "Category (VI)": item.subtitleVi,
      "Category (EN)": item.subtitleEn,
      Stock: item.stock,
      Unit: item.unit,
    }))
  )
  XLSX.utils.book_append_sheet(workbook, inventorySheet, "Inventory Status")

  const tableStatusSheet = XLSX.utils.json_to_sheet([
    { Available: tableCounts.available, Occupied: tableCounts.occupied, Cleaning: tableCounts.cleaning },
  ])
  XLSX.utils.book_append_sheet(workbook, tableStatusSheet, "Table Status")

  const todayIso = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(workbook, `phadincafe-dashboard-${todayIso}.xlsx`)
}
