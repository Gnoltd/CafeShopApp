import type { ReactNode } from "react"
import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { useSizeModifierSelection } from "./useSizeModifierSelection"
import { QuickAddPopup } from "@/components/customer/quick-add-popup"
import type { MenuItem } from "@/lib/supabase/menu-data"

vi.mock("next-intl", () => ({
  useLocale: () => "vi",
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

vi.mock("@/components/motion/bottom-sheet", () => ({
  BottomSheet: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
}))

vi.mock("@/components/ui/dialog", () => ({
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogClose: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
}))

vi.mock("@/components/motion/segmented-control", () => ({
  SegmentedControl: ({
    options,
    value,
    onChange,
  }: {
    options: { value: string; label: string }[]
    value: string
    onChange: (value: string) => void
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock("@/components/motion/press-feedback", () => ({
  PressFeedback: ({ children, ...props }: { children?: ReactNode }) => <button {...props}>{children}</button>,
}))

const sampleItem: MenuItem = {
  id: "item-latte",
  nameVi: "Bạc xỉu",
  nameEn: "Latte",
  descriptionVi: "",
  descriptionEn: "",
  basePrice: 30000,
  categoryIds: ["cat-1"],
  isAvailable: true,
  isPopular: false,
  hasSizeOptions: true,
  sizes: [
    { id: "size-s", name: "S", priceDelta: 0, sortOrder: 0 },
    { id: "size-l", name: "L", priceDelta: 10000, sortOrder: 1 },
  ],
  modifierGroups: [
    {
      id: "grp-sugar",
      nameVi: "Đường",
      nameEn: "Sugar",
      required: true,
      options: [
        { id: "opt-normal", nameVi: "100%", nameEn: "100%", priceDelta: 0 },
        { id: "opt-less", nameVi: "50%", nameEn: "50%", priceDelta: 0 },
      ],
    },
    {
      id: "grp-shot",
      nameVi: "Thêm shot",
      nameEn: "Extra shot",
      required: false,
      options: [{ id: "opt-shot", nameVi: "Thêm shot", nameEn: "Extra shot", priceDelta: 5000 }],
    },
  ],
  imageUrl: null,
  icon: "coffee",
}

describe("useSizeModifierSelection", () => {
  it("computes default size, required modifiers, price, and canonical MenuItemSelection", () => {
    const { result } = renderHook(() => useSizeModifierSelection(sampleItem))

    expect(result.current.price).toBe(30000)
    expect(result.current.selection).toEqual({
      menuItemId: "item-latte",
      sizeId: "size-s",
      modifierIds: ["opt-normal"],
    })

    act(() => {
      result.current.setSelectedSizeId("size-l")
      result.current.toggleModifier(sampleItem.modifierGroups[1], "opt-shot")
    })

    expect(result.current.price).toBe(45000)
    expect(result.current.selection).toEqual({
      menuItemId: "item-latte",
      sizeId: "size-l",
      modifierIds: ["opt-normal", "opt-shot"],
    })
  })
})

describe("QuickAddPopup & SizeExtrasSheet unified MenuItemSelection", () => {
  it("emits only the canonical MenuItemSelection shape without legacy CartItem bloat", async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onClose = vi.fn()

    render(<QuickAddPopup item={sampleItem} onAdd={onAdd} onClose={onClose} />)

    await user.click(screen.getByRole("button", { name: /L \+/i }))
    await user.click(screen.getByRole("button", { name: /Thêm shot/i }))
    await user.click(screen.getByRole("button", { name: "Menu.add" }))

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith({
      menuItemId: "item-latte",
      sizeId: "size-l",
      modifierIds: ["opt-normal", "opt-shot"],
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
