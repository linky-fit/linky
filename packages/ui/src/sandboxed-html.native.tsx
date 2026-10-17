import { Platform, useWindowDimensions } from "react-native";
import { WebView } from "react-native-webview";
import type { SandboxedHtmlProps } from "./sandboxed-html-document";
import { useSandboxedHtmlDocument } from "./sandboxed-html-document";
import { radius } from "./tokens";
import {
  openLinkOutside,
  type ShouldStartLoadRequest,
} from "./web-view.native";

export type { SandboxedHtmlProps } from "./sandboxed-html-document";

/** The document itself loads; every other load is a followed link, which leaves the web view. */
const keepInside = (request: ShouldStartLoadRequest): boolean => {
  if (/^(about|data):/.test(request.url)) return true;
  // Android reports every load as "other"; without scripts only a tapped link navigates there.
  if (Platform.OS === "android" || request.navigationType === "click")
    openLinkOutside(request.url);
  return false;
};

/**
 * Third-party HTML in a web view without JavaScript, storage or file
 * access. Links open outside the app, never inside the view.
 */
export function SandboxedHtml({ html, title, height }: SandboxedHtmlProps) {
  const document = useSandboxedHtmlDocument(html);
  const window = useWindowDimensions();
  return (
    <WebView
      source={{ html: document }}
      accessibilityLabel={title}
      javaScriptEnabled={false}
      domStorageEnabled={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      incognito
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={keepInside}
      onOpenWindow={(event) => openLinkOutside(event.nativeEvent.targetUrl)}
      style={{
        width: "100%",
        height: height ?? Math.round(window.height * 0.6),
        borderRadius: radius.card,
        backgroundColor: "transparent",
      }}
    />
  );
}
