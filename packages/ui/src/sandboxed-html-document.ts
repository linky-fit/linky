import { getVariableValue, useTheme } from "tamagui";
import { fontFamily } from "./tokens";

export interface SandboxedHtmlProps {
  /** Sanitized HTML for the body; it renders without scripts, same-origin access or remote resources. */
  html: string;
  /** Names the frame for assistive technology. */
  title: string;
  /** The frame scrolls its own content past this height in px; defaults to most of the viewport. */
  height?: number | undefined;
}

// Data images only: nothing in the frame may reach the network.
const POLICY =
  "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:";

/** The page a sandboxed frame shows `html` in, styled with the theme's text colours. */
export const useSandboxedHtmlDocument = (html: string): string => {
  const theme = useTheme();
  const color = (name: "color" | "colorMuted" | "infoText") =>
    String(getVariableValue(theme[name]));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
body{margin:0;font:16px/24px ${fontFamily.body};color:${color("color")};overflow-wrap:anywhere}
img,video{max-width:100%;height:auto}
a{color:${color("infoText")}}
small,figcaption{color:${color("colorMuted")}}
</style></head><body>${html}</body></html>`;
};
