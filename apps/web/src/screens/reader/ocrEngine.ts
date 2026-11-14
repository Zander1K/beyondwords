// One OCR engine (and Web Worker) for the whole app; its models load on the first read.
import { PaddleOcr } from "@/vision";

export const ocr = new PaddleOcr();
