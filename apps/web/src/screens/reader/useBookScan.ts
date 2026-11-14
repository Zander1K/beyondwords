// Scan a book from the Reader: press "Scan book" with the barcode (or the cover) in front of the
// camera. A sharp still is taken from the live view and sent to be read (Nemotron reads the ISBN, or
// the title if there is none); the book is stored, added to the reader's library and becomes the
// current book. The result shows on the glasses display and in a note by the dock. The photo is read
// and not kept. Needs the camera to be on and a server profile (their library lives there).
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { useAccess } from "@/access";
import { frameToJpeg, scanBook } from "@/api";
import { useBooks, useReaderStore } from "@/state";

import {
  SCAN_NEEDS_CAMERA,
  SCAN_NEEDS_PROFILE,
  SCANNING,
  scanFailureText,
  scanSuccessText,
} from "./bookScanText";

/** How long the result note stays by the dock. */
const NOTE_MS = 10_000;

export interface BookScan {
  busy: boolean;
  /** The result (or why it could not start), shown until dismissed or it times out. */
  note: string | null;
  scan: () => Promise<void>;
}

export function useBookScan(videoRef: RefObject<HTMLVideoElement | null>): BookScan {
  const userId = useAccess((s) => s.userId);
  const added = useBooks((b) => b.added);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const say = useCallback((text: string, card?: { title: string }) => {
    clearTimeout(timer.current);
    setNote(text);
    timer.current = setTimeout(() => setNote(null), NOTE_MS);
    // Also on the glasses display, when it is in use.
    if (card && useReaderStore.getState().session === "started") {
      useReaderStore.getState().showCard({ word: card.title, short: text });
    }
  }, []);

  const scan = useCallback(async () => {
    const video = videoRef.current;
    if (busy) return;
    if (!video || video.readyState < 2 || !video.videoWidth) return say(SCAN_NEEDS_CAMERA);
    if (userId === null) return say(SCAN_NEEDS_PROFILE);
    setBusy(true);
    say(SCANNING, { title: "Book scan" });
    try {
      const book = await scanBook(userId, await frameToJpeg(video));
      added(book); // it becomes the current book: answers now fit it
      say(scanSuccessText(book), { title: "Book added" });
    } catch (error) {
      say(scanFailureText(error), { title: "Book scan" });
    } finally {
      setBusy(false);
    }
  }, [added, busy, say, userId, videoRef]);

  return { busy, note, scan };
}
