// HACK: a hard-coded demo page until page analysis exists. Written for this repo; not taken
// from any book (never commit copyrighted book text).
import { line, type Page, phrase } from "./page";

export const DEMO_PAGE: Page = {
  id: "demo-page-1",
  lines: [
    line(
      phrase("The old lighthouse", "lighthouse", "A tall tower with a light that guides ships."),
      phrase("stood alone"),
    ),
    line(phrase("at the edge"), phrase("of the grey cliffs,")),
    line(phrase("and every night"), phrase("its lamp", "lamp", "A light, often with a flame.")),
    line(
      phrase("swept slowly across"),
      phrase("the restless water.", "restless", "Always moving; never calm."),
    ),
  ],
};
