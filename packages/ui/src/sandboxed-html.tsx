import type { ReactElement } from "react";
import type { SandboxedHtmlProps } from "./sandboxed-html-document";

export type { SandboxedHtmlProps } from "./sandboxed-html-document";

/** The props every platform's SandboxedHtml takes; `sandboxed-html.web.tsx` and `.native.tsx` render it. */
export const SandboxedHtml: (
  props: SandboxedHtmlProps,
) => ReactElement | null = () => null;
