import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MenuCategory, MenuPort } from "@/lib/supabase/menu-data"
import { MenuItemForm } from "./menu-item-form"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    <span data-testid="next-image" data-src={src} aria-label={alt} />
  ),
}))

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.createClient(),
}))

const CATEGORIES: MenuCategory[] = [
  { id: "cat-1", nameVi: "Cà Phê", nameEn: "Coffee", sortOrder: 0 },
]

function createFormPort(overrides: Partial<MenuPort> = {}): MenuPort {
  return {
    getCategories: vi.fn(async () => CATEGORIES),
    getMenuItems: vi.fn(async () => []),
    getMenuItemById: vi.fn(async () => null),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    deleteCategory: vi.fn(),
    createMenuItem: vi.fn(),
    updateMenuItem: vi.fn(),
    deleteMenuItem: vi.fn(),
    getModifierGroups: vi.fn(async () => []),
    createModifierGroup: vi.fn(),
    updateModifierGroup: vi.fn(),
    setItemModifierGroups: vi.fn(),
    setItemCategories: vi.fn(),
    setItemSizes: vi.fn(),
    uploadMenuItemImage: vi.fn(async () => "https://cdn.example.com/coffee.png"),
    saveMenuItem: vi.fn(),
    ...overrides,
  }
}

function fillRequiredFields() {
  const textboxes = screen.getAllByRole("textbox")
  fireEvent.change(textboxes[0], { target: { value: "Cà Phê Đen" } })
  fireEvent.change(textboxes[1], { target: { value: "Black Coffee" } })
  const priceInput = screen.getByRole("spinbutton")
  fireEvent.change(priceInput, { target: { value: "25000" } })
}

describe("MenuItemForm (Seam 4: real validateMenuItemImageFile + injected MenuPort)", () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    mocks.createClient.mockReset()
    URL.createObjectURL = vi.fn(() => "blob:preview-url")
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  it("uses injected MenuPort without calling createClient and fetches modifier groups once across rerenders", async () => {
    const port = createFormPort()
    const { rerender } = render(
      <MenuItemForm categories={CATEGORIES} onCancel={vi.fn()} onSave={vi.fn()} port={port} />
    )

    await waitFor(() => expect(port.getModifierGroups).toHaveBeenCalledTimes(1))

    rerender(<MenuItemForm categories={[...CATEGORIES]} onCancel={vi.fn()} onSave={vi.fn()} port={port} />)

    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(port.getModifierGroups).toHaveBeenCalledTimes(1)
  })

  it("rejects non-image and oversized files via real validateMenuItemImageFile without triggering an upload", async () => {
    const port = createFormPort()
    render(<MenuItemForm categories={CATEGORIES} onCancel={vi.fn()} onSave={vi.fn()} port={port} />)
    await waitFor(() => expect(port.getModifierGroups).toHaveBeenCalledTimes(1))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    const pdf = new File(["pdf"], "menu.pdf", { type: "application/pdf" })
    fireEvent.change(fileInput, { target: { files: [pdf] } })
    expect(screen.getByText("AdminMenu.imageInvalidTypeError")).toBeInTheDocument()

    const hugeImage = new File(["x"], "huge.png", { type: "image/png" })
    Object.defineProperty(hugeImage, "size", { value: 5 * 1024 * 1024 + 1 })
    fireEvent.change(fileInput, { target: { files: [hugeImage] } })
    expect(screen.getByText("AdminMenu.imageTooLargeError")).toBeInTheDocument()
    expect(port.uploadMenuItemImage).not.toHaveBeenCalled()
  })

  it("shows uploading busy state via port.uploadMenuItemImage and passes the uploaded public URL to onSave", async () => {
    let resolveUpload!: (url: string) => void
    const port = createFormPort({
      uploadMenuItemImage: vi.fn(
        () => new Promise<string>((resolve) => { resolveUpload = resolve })
      ),
    })
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(<MenuItemForm categories={CATEGORIES} onCancel={vi.fn()} onSave={onSave} port={port} />)
    await waitFor(() => expect(port.getModifierGroups).toHaveBeenCalledTimes(1))

    fillRequiredFields()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const validImage = new File(["img"], "coffee.png", { type: "image/png" })
    fireEvent.change(fileInput, { target: { files: [validImage] } })

    fireEvent.click(screen.getByRole("button", { name: "AdminMenu.save" }))

    const uploadingBtn = await screen.findByRole("button", { name: "AdminMenu.uploadingButton" })
    expect(uploadingBtn).toBeDisabled()
    expect(port.uploadMenuItemImage).toHaveBeenCalledWith(validImage)
    expect(onSave).not.toHaveBeenCalled()

    await act(async () => {
      resolveUpload("https://cdn.example.com/coffee.png")
    })

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          nameVi: "Cà Phê Đen",
          nameEn: "Black Coffee",
          basePrice: 25000,
          imageUrl: "https://cdn.example.com/coffee.png",
        }),
        [],
        []
      )
    })
  })

  it("displays an inline error and aborts onSave when port.uploadMenuItemImage rejects", async () => {
    const port = createFormPort({
      uploadMenuItemImage: vi.fn().mockRejectedValue(new Error("storage failed")),
    })
    const onSave = vi.fn()

    render(<MenuItemForm categories={CATEGORIES} onCancel={vi.fn()} onSave={onSave} port={port} />)
    await waitFor(() => expect(port.getModifierGroups).toHaveBeenCalledTimes(1))

    fillRequiredFields()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const validImage = new File(["img"], "coffee.png", { type: "image/png" })
    fireEvent.change(fileInput, { target: { files: [validImage] } })

    fireEvent.click(screen.getByRole("button", { name: "AdminMenu.save" }))

    expect(await screen.findByText("AdminMenu.imageUploadError")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "AdminMenu.save" })).toBeEnabled()
    expect(onSave).not.toHaveBeenCalled()
  })
})
