// Wraps the app's screens: anyone who has not signed in is sent to the landing page, which asks
// for access (and brings them back to where they were headed). A reader the server says has not
// done first-run setup is sent to the welcome screen once; a reader whose saved comfort settings
// the server knows gets them applied.
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { GlassesProvider } from "@/glasses";
import { useSettings } from "@/state";

import { useAccess } from "./store";

/** Where the landing page sends someone who has just signed in. */
export const AFTER_SIGN_IN = "/reader";
/** First-run setup. */
export const WELCOME_PATH = "/welcome";

export function RequireAccess() {
  const user = useAccess((s) => s.user);
  const profile = useAccess((s) => s.profile);
  const skipped = useAccess((s) => s.onboardingSkipped);
  const setSpacing = useSettings((s) => s.setSpacing);
  const location = useLocation();

  // Their saved comfort settings, once the server has told us (and only when they have some).
  const saved = profile?.spacing;
  useEffect(() => {
    if (!saved) return;
    setSpacing({
      letterSpacing: saved.letter_spacing,
      wordSpacing: saved.word_spacing,
      lineHeight: saved.line_height,
      fontSize: saved.font_size,
    });
  }, [saved, setSpacing]);

  if (!user) {
    return <Navigate to="/" replace state={{ needAccess: true, from: location.pathname }} />;
  }
  // The profile is unknown while the server has not answered (or is down): never block on that.
  if (profile && !profile.onboarded && !skipped && location.pathname !== WELCOME_PATH) {
    return <Navigate to={WELCOME_PATH} replace state={{ from: location.pathname }} />;
  }
  // The simulated glasses exist only inside the app, not on the landing page.
  return (
    <GlassesProvider>
      <Outlet />
    </GlassesProvider>
  );
}
