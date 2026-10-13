import { WebView } from "react-native-webview";
import { Stack } from "./layout";
import type { VideoEmbedProps } from "./video-embed-props";
import {
  openLinkOutside,
  type ShouldStartLoadRequest,
} from "./web-view.native";

export type { VideoEmbedProps } from "./video-embed-props";

// Players refuse to play without a referrer, so the frame loads from the hosted app's origin, as on the web.
const HOST_ORIGIN = "https://app.linky.fit/";

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const playerPage = (src: string, title: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;background:#000}</style></head><body><iframe src="${escapeAttribute(src)}" title="${escapeAttribute(title)}" allow="encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`;

/** The player page and its frames load; a link out of it opens outside the app. */
const keepInside = (request: ShouldStartLoadRequest): boolean => {
  if (!request.isTopFrame || request.url === HOST_ORIGIN) return true;
  if (request.url.startsWith("about:")) return true;
  openLinkOutside(request.url);
  return false;
};

/** A third-party video player in a rounded 16:9 frame, as wide as its column. */
export function VideoEmbed({ src, title }: VideoEmbedProps) {
  return (
    <Stack
      width="100%"
      aspectRatio={16 / 9}
      overflow="hidden"
      borderRadius="$card"
      backgroundColor="$neutralSoft"
    >
      <WebView
        source={{ html: playerPage(src, title), baseUrl: HOST_ORIGIN }}
        accessibilityLabel={title}
        allowsInlineMediaPlayback
        allowsFullscreenVideo
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={keepInside}
        onOpenWindow={(event) => openLinkOutside(event.nativeEvent.targetUrl)}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </Stack>
  );
}
