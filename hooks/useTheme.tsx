"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

type Theme = "light" | "dark"

type ThemeContextValue = {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = "phadincafe-theme"

// Exported for testing (hooks/useTheme.test.ts) -- pure, no React needed.
export function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light"
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always initialize to "light" -- the same value the server renders,
  // since the server has no access to localStorage/matchMedia. The actual
  // dark/light class on <html> is already set correctly before hydration
  // by the inline no-flash script in the root layout (see
  // app/[locale]/layout.tsx); reading it here during the initial render
  // instead would make this component's first client render diverge from
  // the server-rendered markup (e.g. ThemeToggle's icon/aria-label),
  // triggering a React hydration mismatch (#418). The effect below
  // corrects `theme` to match reality immediately after mount.
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    setTheme(readInitialTheme())
  }, [])

  function toggleTheme() {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark"
      document.documentElement.classList.toggle("dark", next === "dark")
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
