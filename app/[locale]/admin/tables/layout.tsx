import { TablesProvider } from "@/hooks/useTables"

export default function AdminTablesLayout({ children }: { children: React.ReactNode }) {
  return <TablesProvider>{children}</TablesProvider>
}
