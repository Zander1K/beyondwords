// The hero's video, playing behind everything else: a short looping clip of someone reading.
// Decorative (aria-hidden), muted (which is also what lets browsers autoplay it) and inline on
// phones. It is treated for the black-and-blue scheme: tinted blue and shaded dark, most of all on
// the left where the headline sits. The poster (the clip's first frame) shows until it plays, and
// stays as the picture for anyone who asked for reduced motion or to save data. It pauses
// whenever it is off-screen or the tab is hidden, so it costs nothing while unseen.
import { useEffect, useRef, useState } from "react";

import styles from "./HeroVideo.module.css";

const SRC = "/hero-bg.mp4";
const POSTER = "/hero-poster.jpg";

type SaveDataNavigator = Navigator & { connection?: { saveData?: boolean } };

/** Play the video unless the visitor asked for less motion or to save data. */
function wantsVideo(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  return !(navigator as SaveDataNavigator).connection?.saveData;
}

export function HeroVideo() {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [play, setPlay] = useState(wantsVideo);
  const [ready, setReady] = useState(false);

  // Follow a change of the reduced-motion setting while the page is open.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setPlay(wantsVideo());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Play only while the hero is on screen and the tab is visible.
  useEffect(() => {
    const el = video.current;
    const area = stage.current;
    if (!play || !el || !area) return;
    el.muted = true; // as a property too: React does not always render the attribute, and iOS needs it
    let onScreen = true;
    const update = () => {
      if (onScreen && !document.hidden) {
        // Autoplay can be refused (iOS low-power mode): then the poster simply stays.
        el.play().catch(() => undefined);
      } else {
        el.pause();
      }
    };
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      update();
    });
    io.observe(area);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [play]);

  return (
    <div ref={stage} className={styles.stage} aria-hidden="true" data-ready={ready}>
      {play && (
        <video
          ref={video}
          className={styles.video}
          src={SRC}
          poster={POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          tabIndex={-1}
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => setReady(true)}
        />
      )}
      <div className={styles.tint} />
      <div className={styles.shade} />
    </div>
  );
}
