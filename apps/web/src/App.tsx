import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from "react-router";

import { RequireAccess, useAccess } from "@/access";
import { useApiStatus } from "@/api";
import { APP_NAME } from "@/config";
import { Landing } from "@/landing";
import { LibraryScreen, ReaderScreen, SettingsScreen, WordBankScreen } from "@/screens";
import { SpacingVars } from "@/ui";

import styles from "./App.module.css";

const NAV = [
  { to: "/library", label: "Library" },
  { to: "/reader", label: "Reader" },
  { to: "/words", label: "Word Bank" },
  { to: "/settings", label: "Settings" },
] as const;

/** The app's frame: brand, the main navigation, and who is signed in. */
function Layout() {
  const user = useAccess((s) => s.user);
  const signOut = useAccess((s) => s.signOut);
  const navigate = useNavigate();
  const api = useApiStatus();
  const apiLabel =
    api.state === "checking"
      ? "Checking the API"
      : api.state === "offline"
        ? "API offline"
        : api.database === "ok"
          ? "API connected"
          : "API connected, database unavailable";
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
        <div className={styles.account}>
          <span className={styles.api} data-state={api.state} role="status">
            <span className={styles.apiDot} aria-hidden="true" />
            {apiLabel}
          </span>
          {user && <span className={styles.user}>Signed in as {user}</span>}
          <button
            type="button"
            className={styles.signOut}
            onClick={() => {
              signOut();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
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
      <Routes>
        {/* Public: the landing page, whose one call to action asks for access. */}
        <Route index element={<Landing />} />
        {/* Everything else needs the username and access password. */}
        <Route element={<RequireAccess />}>
          <Route element={<Layout />}>
            <Route path="library" element={<LibraryScreen />} />
            <Route path="reader" element={<ReaderScreen />} />
            <Route path="words" element={<WordBankScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
