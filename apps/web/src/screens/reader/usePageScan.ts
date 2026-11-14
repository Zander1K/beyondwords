// Page scan pipeline (SIM-CAM-02, SIM-VIS-02): a camera still or uploaded photo -> OCR line
// boxes -> page analysis (MOCK) -> the reader's page. The camera view is the only source of
// what is being read.
import { useEffect } from "react";

import { analyzePage } from "@/api";
import { useReaderStore } from "@/state";
import { PaddleOcr } from "@/vision";

import type { PageImage } from "./useCamera";

// One OCR worker for the app; it loads its model on first use.
const ocr = new PaddleOcr();

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
