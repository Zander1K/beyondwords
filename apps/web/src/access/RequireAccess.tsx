// Wraps the app's screens: anyone who has not signed in is sent to the landing page, which asks
// for access (and brings them back to where they were headed).
import { Navigate, Outlet, useLocation } from "react-router";

import { GlassesProvider } from "@/glasses";

import { useAccess } from "./store";

/** Where the landing page sends someone who has just signed in. */
export const AFTER_SIGN_IN = "/reader";

export function RequireAccess() {
  const user = useAccess((s) => s.user);
  const location = useLocation();
  if (!user) {
    return <Navigate to="/" replace state={{ needAccess: true, from: location.pathname }} />;
  }
  // The simulated glasses exist only inside the app, not on the landing page.
  return (
    <GlassesProvider>
      <Outlet />
    </GlassesProvider>
  );
}
