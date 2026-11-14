// Single-image scan (SIM-CAM-03 fallback): an uploaded page photo -> OCR -> page analysis
// (MOCK) -> the reader's page. The live camera is scanned continuously by useLiveScan instead.
import { useEffect } from "react";

import { analyzePage } from "@/api";
import { useReaderStore } from "@/state";

import { ocr } from "./ocrEngine";
import type { PageImage } from "./useCamera";

export function usePageScan(image: PageImage | null): void {
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    const { setScan, setPage } = useReaderStore.getState();
    setScan({ status: "scanning", source: image.source });
    void (async () => {
      try {
        const result = await ocr.recognize(image.blob);
        if (cancelled) return;
        if (result.lines.length === 0) {
          // Keep the previous page; tell the user nothing readable was found.
          setScan({ status: "empty", source: image.source, ocrMs: result.ms });
          return;
        }
        const page = await analyzePage(result.lines);
        if (cancelled) return;
        setPage(page);
        setScan({
          status: "ready",
          source: image.source,
          lines: page.lines.length,
          ocrMs: result.ms,
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("[vision] page scan failed", error);
        setScan({
          status: "error",
          message: "Reading the page failed. Check the connection (the OCR model downloads once).",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image]);
}
