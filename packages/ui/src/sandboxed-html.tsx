export interface SandboxedHtmlProps {
  /** Sanitized HTML for the body; it renders without scripts, same-origin access or remote resources. */
  html: string;
  /** Names the frame for assistive technology. */
  title: string;
  /** The frame scrolls its own content past this height in px; defaults to most of the viewport. */
  height?: number | undefined;
}

/** Sandboxed frames are a web API; native apps render publisher HTML in their own web view instead. */
export const SandboxedHtml: (props: SandboxedHtmlProps) => null = () => null;
