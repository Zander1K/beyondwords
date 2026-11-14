// Where phrases sit along a line, by character position. Used to map a fingertip's x position
// to a phrase and to draw the phrase highlight on the camera view.
import type { Page } from "./page";
import type { ReaderPosition } from "./readerMachine";

/** The [start, end) fraction of its line that the phrase at `position` takes up. */
export function phraseSpan(page: Page, position: ReaderPosition): [number, number] | null {
  const line = page.lines[position.line];
  if (!line || !line.text.length) return null;
  let offset = 0;
  for (let i = 0; i < line.phrases.length; i++) {
    const text = line.phrases[i]?.text ?? "";
    if (i === position.phrase) {
      return [offset / line.text.length, (offset + text.length) / line.text.length];
    }
    offset += text.length + 1;
  }
  return null;
}
