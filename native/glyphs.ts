// The cube colours' icons (js/content.js COLORS: ♥ ★ ▲ ◆ ☾ ✿), drawn as
// shapes: the runtime's fonts lack some of these symbols, and the goal
// swatches, the title mosaic and Help show them at any size.
import * as draw from "starhermit:draw";

type Pt = [number, number];
function heart(cx: number, cy: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([cx + (x / 17) * r, cy - (y / 17) * r + r * 0.1]);
  }
  return pts;
}
function star(cx: number, cy: number, r: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr + r * 0.08]);
  }
  return pts;
}
/** Colour `idx`'s icon centred at (cx, cy), `r` its radius (window pixels). */
export function icon(idx: number, cx: number, cy: number, r: number, color: string, bg: string): void {
  switch (idx % 6) {
    case 0: draw.polygon(heart(cx, cy, r), color); break;
    case 1: draw.polygon(star(cx, cy, r), color); break;
    case 2: draw.polygon([[cx, cy - r * 0.9], [cx + r * 0.9, cy + r * 0.7], [cx - r * 0.9, cy + r * 0.7]], color); break;
    case 3: draw.polygon([[cx, cy - r], [cx + r * 0.75, cy], [cx, cy + r], [cx - r * 0.75, cy]], color); break;
    case 4: // crescent: a disc with an offset disc in the background colour cut out
      draw.circle(cx, cy, r * 0.85, color);
      draw.circle(cx + r * 0.42, cy - r * 0.18, r * 0.72, bg);
      break;
    default: // flower: five petals round a centre
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        draw.circle(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.42, color);
      }
      draw.circle(cx, cy, r * 0.28, bg);
  }
}
