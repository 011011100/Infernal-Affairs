import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";
const THEME_KEY = "wujian-theme-v1";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(
  null,
);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#f3f5f8" : "#08090d");
  }, [theme]);

  useEffect(() => {
    const syncPreference = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) {
        setTheme(event.newValue === "light" ? "light" : "dark");
      }
    };
    window.addEventListener("storage", syncPreference);
    return () => window.removeEventListener("storage", syncPreference);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Keep the switch usable when browser storage is unavailable.
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeToggle requires ThemeProvider");
  const { theme, toggle } = context;
  const isLight = theme === "light";
  const label = `切换到${isLight ? "黑夜" : "白天"}模式`;
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {isLight ? <Sun size={17} /> : <Moon size={17} />}
      <span>{isLight ? "白天" : "黑夜"}</span>
    </button>
  );
}
