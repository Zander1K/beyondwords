// Draws the reading highlight on the camera view and keeps it moving smoothly: the phrase,
// word and underline glide to each new position instead of jumping, and the canvas only redraws
// while something is moving or changing.
//
// Look: the line gets a faint ruler, the phrase a violet-blue glass band with a soft glow, the
// word a bright marker with an underline in the assistant-ring colours, and the fingertip a ring
// with a dot. Text boxes and the hand skeleton are debug aids, off by default.
import type { Page, ReaderPosition } from "@/reader";

import {
  computeHighlight,
  easePoly,
  type Highlight,
  NO_HIGHLIGHT,
  type Poly,
  polyGap,
  type Pt,
} from "./overlayGeometry";
import type { OverlayHand } from "./VisionOverlay";

export interface OverlayProps {
  page: Page;
  position: ReaderPosition;
  hands: readonly OverlayHand[];
  showSkeleton: boolean;
  showBoxes: boolean;
  connections: ReadonlyArray<{ start: number; end: number }> | undefined;
}

/** Time for a highlight to cover ~63% of the way to its target. */
const EASE_MS = 70;
/** Stop animating when every highlight is this close to its target (normalised). */
const SETTLED = 0.0006;

const VIOLET = "rgb(150 112 255)";

/** A rounded polygon: each corner rounded by `r` (limited to half the shortest edge). */
function roundedPath(ctx: CanvasRenderingContext2D, pts: readonly Pt[], radius: number): void {
  const n = pts.length;
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (a && b) shortest = Math.min(shortest, Math.hypot(b.x - a.x, b.y - a.y));
  }
  const r = Math.max(0, Math.min(radius, shortest / 2));
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const last = pts[n - 1];
  const first = pts[0];
  if (!last || !first) return;
  const start = mid(last, first);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const next = pts[(i + 1) % n];
    if (!p || !next) continue;
    const m = mid(p, next);
    ctx.arcTo(p.x, p.y, m.x, m.y, r);
  }
  ctx.closePath();
}

const toPx = (q: Poly, w: number, h: number): Pt[] => q.map((p) => ({ x: p.x * w, y: p.y * h }));

function gradientAcross(ctx: CanvasRenderingContext2D, q: Pt[], a: string, b: string) {
  // From the top-left to the top-right corner of the band.
  const left = q[0];
  const right = q[q.length / 2 - 1];
  const g = ctx.createLinearGradient(left?.x ?? 0, left?.y ?? 0, right?.x ?? 0, right?.y ?? 0);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

function drawHighlight(ctx: CanvasRenderingContext2D, h: Highlight, w: number, ht: number) {
  // The line: a faint ruler, so you can see which line is being read.
  if (h.line) {
    const q = toPx(h.line, w, ht);
    roundedPath(ctx, q, 10);
    ctx.fillStyle = "rgb(255 255 255 / 0.08)";
    ctx.fill();
  }

  // The phrase: violet-blue glass with a soft glow.
  if (h.phrase) {
    const q = toPx(h.phrase, w, ht);
    ctx.save();
    ctx.shadowColor = "rgb(140 100 255 / 0.65)";
    ctx.shadowBlur = 22;
    roundedPath(ctx, q, 12);
    ctx.fillStyle = gradientAcross(ctx, q, "rgb(150 112 255 / 0.4)", "rgb(80 140 255 / 0.3)");
    ctx.fill();
    ctx.restore();
    roundedPath(ctx, q, 12);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgb(255 255 255 / 0.55)";
    ctx.stroke();
  }

  // The word: a brighter marker inside the phrase.
  if (h.word) {
    const q = toPx(h.word, w, ht);
    ctx.save();
    ctx.shadowColor = "rgb(190 160 255 / 0.9)";
    ctx.shadowBlur = 14;
    roundedPath(ctx, q, 8);
    ctx.fillStyle = "rgb(255 255 255 / 0.3)";
    ctx.fill();
    ctx.restore();
    roundedPath(ctx, q, 8);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgb(255 255 255 / 0.95)";
    ctx.stroke();
  }

  // The underline, in the assistant-ring colours.
  if (h.underline) {
    const q = toPx(h.underline, w, ht);
    roundedPath(ctx, q, 99);
    ctx.fillStyle = gradientAcross(ctx, q, "#38bdf8", "#c14fe0");
    ctx.fill();
  }
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  hand: OverlayHand,
  w: number,
  h: number,
  options: Pick<OverlayProps, "showSkeleton" | "connections">,
) {
  const pointer = hand.role === "pointer";
  const tint = pointer ? "255 255 255" : hand.role === "gesture" ? "120 240 170" : "200 200 210";

  if (hand.finger) {
    // A lone finger: a line fading in from where it enters the frame to the tip.
    const [base, end] = hand.landmarks;
    if (base && end) {
      const g = ctx.createLinearGradient(base.x * w, base.y * h, end.x * w, end.y * h);
      g.addColorStop(0, "rgb(255 255 255 / 0)");
      g.addColorStop(1, "rgb(255 255 255 / 0.75)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(base.x * w, base.y * h);
      ctx.lineTo(end.x * w, end.y * h);
      ctx.stroke();
    }
  } else if (options.showSkeleton && options.connections) {
    ctx.strokeStyle = `rgb(${tint} / 0.6)`;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const { start, end } of options.connections) {
      const a = hand.landmarks[start];
      const b = hand.landmarks[end];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x * w, a.y * h);
      ctx.lineTo(b.x * w, b.y * h);
      ctx.stroke();
    }
  }

  // The index fingertip (landmark 8); on the pointing hand, the smoothed cursor it drives.
  const tip = hand.cursor ?? (hand.finger ? hand.landmarks[1] : hand.landmarks[8]);
  if (!tip) return;
  const x = tip.x * w;
  const y = tip.y * h;
  if (pointer) {
    ctx.save();
    ctx.shadowColor = VIOLET;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgb(255 255 255 / 0.95)";
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgb(${tint} / 0.8)`;
    ctx.stroke();
  }
}

function drawBoxes(ctx: CanvasRenderingContext2D, page: Page, w: number, h: number) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgb(255 255 255 / 0.35)";
  for (const line of page.lines) {
    const b = line.box;
    if (b) ctx.strokeRect(b.x * w, b.y * h, b.w * w, b.h * h);
    ctx.strokeStyle = "rgb(120 200 255 / 0.5)";
    for (const word of line.words ?? []) {
      ctx.strokeRect(word.box.x * w, word.box.y * h, word.box.w * w, word.box.h * h);
    }
    ctx.strokeStyle = "rgb(255 255 255 / 0.35)";
  }
}

/** The overlay for one canvas. `update()` after the props change; `dispose()` when done. */
export function createOverlay(canvas: HTMLCanvasElement, props: { current: OverlayProps }) {
  let shown: Highlight = NO_HIGHLIGHT;
  let target: Highlight = NO_HIGHLIGHT;
  let raf = 0;
  let last = 0;

  const size = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });

  const retarget = () => {
    const { w, h } = size();
    const { page, position } = props.current;
    target = w && h ? computeHighlight(page, position, h / w) : NO_HIGHLIGHT;
  };

  const ease = (k: number) => {
    shown = {
      line: easePoly(shown.line, target.line, k),
      phrase: easePoly(shown.phrase, target.phrase, k),
      word: easePoly(shown.word, target.word, k),
      underline: easePoly(shown.underline, target.underline, k),
    };
  };

  const settled = () =>
    (Object.keys(target) as (keyof Highlight)[]).every(
      (key) => polyGap(shown[key], target[key]) < SETTLED,
    );

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size();
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const p = props.current;
    if (p.showBoxes) drawBoxes(ctx, p.page, w, h);
    drawHighlight(ctx, shown, w, h);
    for (const hand of p.hands) drawHand(ctx, hand, w, h, p);
  };

  const frame = (now: number) => {
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;
    ease(1 - Math.exp(-dt / EASE_MS));
    draw();
    if (settled()) {
      shown = target;
      raf = 0;
      last = 0;
      draw();
    } else {
      raf = requestAnimationFrame(frame);
    }
  };

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const observer = new ResizeObserver(() => {
    retarget();
    kick();
  });
  observer.observe(canvas);

  return {
    update() {
      retarget();
      kick();
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
    },
  };
}
