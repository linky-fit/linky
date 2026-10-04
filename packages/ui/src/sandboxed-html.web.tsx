import { getVariableValue, useTheme } from "tamagui";
import type { SandboxedHtmlProps } from "./sandboxed-html";
import { fontFamily, radius } from "./tokens";

export type { SandboxedHtmlProps } from "./sandboxed-html";

// Data images only: nothing in the frame may reach the network.
const POLICY =
  "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:";

/**
 * Third-party HTML in a frame with an opaque origin and no scripts. Links
 * open in a new browsing context outside the sandbox.
 */
export function SandboxedHtml({ html, title, height }: SandboxedHtmlProps) {
  const theme = useTheme();
  const color = (name: "color" | "colorMuted" | "infoText") =>
    String(getVariableValue(theme[name]));
  const document = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
body{margin:0;font:16px/24px ${fontFamily.body};color:${color("color")};overflow-wrap:anywhere}
img,video{max-width:100%;height:auto}
a{color:${color("infoText")}}
small,figcaption{color:${color("colorMuted")}}
</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title={title}
      srcDoc={document}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      style={{
        width: "100%",
        height: height ?? "60vh",
        border: 0,
        borderRadius: radius.card,
        colorScheme: "normal",
      }}
    />
  );
}
