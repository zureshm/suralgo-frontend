"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "default" | "blue" | "brown";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("default");
  const [mounted, setMounted] = useState(false);

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme;
    if (savedTheme && ["default", "blue", "brown"].includes(savedTheme)) {
      setThemeState(savedTheme);
    }
    setMounted(true);
  }, []);

  // Apply theme to HTML element and sync system UI colors
  useEffect(() => {
    if (!mounted) return;

    const html = document.documentElement;
    html.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);

    // Update the meta theme-color for mobile status bar
    requestAnimationFrame(() => {
      const bg = getComputedStyle(html).getPropertyValue("--theme-bg").trim();
      if (bg) {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", bg);
        // Also set html background so system bar areas are filled
        html.style.backgroundColor = bg;
      }
    });
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
