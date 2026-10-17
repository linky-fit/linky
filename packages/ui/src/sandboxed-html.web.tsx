import type { SandboxedHtmlProps } from "./sandboxed-html-document";
import { useSandboxedHtmlDocument } from "./sandboxed-html-document";
import { radius } from "./tokens";

export type { SandboxedHtmlProps } from "./sandboxed-html-document";

/**
 * Third-party HTML in a frame with an opaque origin and no scripts. Links
 * open in a new browsing context outside the sandbox.
 */
export function SandboxedHtml({ html, title, height }: SandboxedHtmlProps) {
  const document = useSandboxedHtmlDocument(html);
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
