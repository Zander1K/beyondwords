// The pixel dot texture on the hero, call-to-action and footer surfaces, after ALX Studio's
// DotField: a grid of small blue dots, carved into organic clusters by value noise, shown mostly
// along the lower edge, twinkling slowly. Decorative (aria-hidden), static for reduced motion,
// and paused while off-screen.
import { useEffect, useRef } from "react";

// Cheap deterministic value noise: enough to carve "landmass" clusters out of a dot grid.
function hash(x: number, y: number, seed: number) {
  let h =
    Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm(x: number, y: number, seed: number) {
  return (
    noise(x, y, seed) * 0.55 +
    noise(x * 2.1, y * 2.1, seed + 7) * 0.3 +
    noise(x * 4.3, y * 4.3, seed + 13) * 0.15
  );
}
const edge = (a: number, b: number, v: number) =>
  smooth(Math.min(1, Math.max(0, (v - a) / (b - a))));

interface Dot {
  x: number;
  y: number;
  a: number;
  p: number;
}

const GAP = 10;
const RGB = "96,165,255";

export function DotField({ seed = 3 }: { seed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: Dot[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let onScreen = true;

    function draw(t: number) {
      ctx!.clearRect(0, 0, w, h);
      for (const d of dots) {
        const twinkle = reduce ? 1 : 0.72 + 0.28 * Math.sin(t / 1400 + d.p);
        ctx!.fillStyle = `rgba(${RGB},${(d.a * twinkle * 0.8).toFixed(3)})`;
        ctx!.fillRect(Math.round(d.x - 1), Math.round(d.y - 1), 2, 2);
      }
    }

    function build() {
      const r = parent!.getBoundingClientRect();
      w = Math.max(1, Math.floor(r.width));
      h = Math.max(1, Math.floor(r.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = [];
      const aspect = w / h;
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const u = x / w;
          const v = y / h;
          const land = edge(0.43, 0.56, fbm(u * 5.2 * aspect * 0.6, v * 5.2, seed));
          // Where the texture shows: mostly the lower edge, with a hint in the lower right corner.
          const lower = edge(0.5, 1, v);
          const corner = Math.max(0, 1 - Math.hypot(u - 0.78, v - 1) * 2.2);
          const a = land * Math.min(1, lower * 0.95 + corner);
          if (a > 0.04)
            dots.push({ x, y, a, p: hash(Math.floor(x), Math.floor(y), seed + 1) * Math.PI * 2 });
        }
      }
      draw(0);
    }

    function loop(now: number) {
      raf = requestAnimationFrame(loop);
      if (!onScreen || now - last < 70) return;
      last = now;
      draw(now);
    }

    build();
    const resize = new ResizeObserver(build);
    resize.observe(parent);
    const visible = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
    });
    visible.observe(parent);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      visible.disconnect();
    };
  }, [seed]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
}
