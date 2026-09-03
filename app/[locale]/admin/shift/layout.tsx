import { ShiftProvider } from "@/hooks/useShift"

export default function AdminShiftLayout({ children }: { children: React.ReactNode }) {
  return <ShiftProvider>{children}</ShiftProvider>
}
