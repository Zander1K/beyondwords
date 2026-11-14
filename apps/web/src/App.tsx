import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router";

import { APP_NAME } from "@/config";
import { GlassesProvider } from "@/glasses";
import { LibraryScreen, ReaderScreen, SettingsScreen, WordBankScreen } from "@/screens";
import { SpacingVars } from "@/ui";

import styles from "./App.module.css";

const NAV = [
  { to: "/", label: "Library" },
  { to: "/reader", label: "Reader" },
  { to: "/words", label: "Word Bank" },
  { to: "/settings", label: "Settings" },
] as const;

function Layout() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>{APP_NAME}</span>
        <nav aria-label="Main">
          <ul className={styles.nav}>
            {NAV.map(({ to, label }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end
                  className={({ isActive }) => (isActive ? styles.active : undefined)}
                >
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SpacingVars />
      <GlassesProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<LibraryScreen />} />
            <Route path="reader" element={<ReaderScreen />} />
            <Route path="words" element={<WordBankScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </GlassesProvider>
    </BrowserRouter>
  );
}
