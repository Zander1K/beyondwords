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

/** The phrase index containing character `offset` of line `line`. */
export function phraseAtOffset(page: Page, line: number, offset: number): number {
  const l = page.lines[line];
  if (!l) return 0;
  let start = 0;
  for (let i = 0; i < l.phrases.length; i++) {
    const end = start + (l.phrases[i]?.text.length ?? 0);
    if (offset < end + 1) return i;
    start = end + 1;
  }
  return Math.max(0, l.phrases.length - 1);
}

/** Character offset where phrase `phrase` starts in its line's text. */
export function phraseStart(page: Page, line: number, phrase: number): number {
  const l = page.lines[line];
  let start = 0;
  for (let i = 0; i < phrase && l; i++) start += (l.phrases[i]?.text.length ?? 0) + 1;
  return start;
}

/** The pointed word as a [start, end) range inside its phrase's text, if it is in that phrase. */
export function pointedWordInPhrase(
  page: Page,
  position: ReaderPosition,
): [number, number] | undefined {
  if (position.word === undefined) return undefined;
  const word = page.lines[position.line]?.words?.[position.word];
  if (!word) return undefined;
  const start = phraseStart(page, position.line, position.phrase);
  const length = page.lines[position.line]?.phrases[position.phrase]?.text.length ?? 0;
  const s = word.start - start;
  const e = word.end - start;
  return s >= 0 && e <= length ? [s, e] : undefined;
}
