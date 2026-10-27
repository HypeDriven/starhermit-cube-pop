// The look of the menus, HUD and dialogs: the browser build's style sheet,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (checkboxes, selects, text
// fields, dialogs, scroll bars) take. The browser build's body.high-contrast
// palette is a token set here, applied while the runtime's high-contrast
// option is on (which also switches the cubes to their high-contrast colours).
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export const INK = {
  bg: "#f6e3c8", panel: "#fff8ee", ink: "#3d2f23", soft: "#6d5b48", accent: "#e4574f", accent2: "#f2c14e",
  focus: "#2e6fe4", danger: "#b3352e", gold: "#c89000", ok: "#2c7a3f",
};
export const INK_HC = { ...INK, bg: "#ffffff", panel: "#ffffff", ink: "#000000", soft: "#222222", accent: "#b3001b", focus: "#0033cc" };
type Tokens = Record<string, string | number>;
let base: Tokens = {};
const HIGH_CONTRAST: Tokens = { bg: "#ffffff", panel: "#ffffff", ink: "#000000", "ink-soft": "#222222", accent: "#b3001b", "accent-hover": "#8f0016", focus: "#0033cc" };

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setTheme({
    fontSize: 16, smallSize: 13.6, headingSize: 24, padding: 8, spacing: 8, radius: 12,
    text: INK.ink, muted: INK.soft, panel: INK.panel, control: INK.panel, hovered: "#ffffff",
    pressed: "#f3e4cc", field: "#ffffff", accent: INK.accent, focus: INK.focus, outline: "#00000022",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ink" } },
    paragraph: { text: { color: "$ink" } },
    heading: { text: { color: "$ink" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    checkbox: {
      text: { color: "$ink" }, minHeight: 44,
      parts: { box: { background: "#ffffff", border: { width: 2, color: "$ink-soft" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { text: { color: "$ink" }, background: "#ffffff", border: { width: 2, color: "#00000022" }, radius: 8, minHeight: 44 },
    textField: { text: { color: "$ink" }, background: "#ffffff", border: { width: 2, color: "#00000022" }, radius: 8, minHeight: 44 },
    dialog: {
      background: "$panel", radius: 16, padding: 20,
      parts: { backdrop: { background: "#3d2f23aa" } },
    },
    scrollArea: { parts: { bar: { background: "$ink-soft", radius: 4 } } },
    tooltip: { background: "$ink", text: { color: "$panel" }, radius: 6, padding: 6 },
  });
}

let hcKey: boolean | null = null;
/** The high-contrast tokens over the sheet's while the runtime's option is on. */
export function applyContrast(highContrast: boolean): void {
  if (hcKey === highContrast) return;
  hcKey = highContrast;
  ui.setTokens(highContrast ? { ...base, ...HIGH_CONTRAST } : base);
}
export function ink(highContrast: boolean): typeof INK { return highContrast ? INK_HC : INK; }
