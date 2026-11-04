"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "fieldfix.theme";

function readStored(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);

/**
 * Dark/light theme state. Dark is the default; the choice persists in
 * localStorage and is applied pre-paint by the layout's inline script
 * to avoid a flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = readStored();
    setTheme(stored);
    apply(stored);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode */
      }
      apply(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}

/** Header theme toggle (sun/moon). */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={theme === "light"}
      className="rounded-md p-2 text-slate-400 transition-colors hover:bg-panel-elevated hover:text-slate-100"
    >
      {theme === "dark" ? (
        <Sun className="size-5" aria-hidden />
      ) : (
        <Moon className="size-5" aria-hidden />
      )}
    </button>
  );
}
