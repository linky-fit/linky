import { Stack } from "./layout";
import type { VideoEmbedProps } from "./video-embed";

export type { VideoEmbedProps } from "./video-embed";

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
      <iframe
        src={src}
        title={title}
        allow="encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ width: "100%", height: "100%", border: 0 }}
      />
    </Stack>
  );
}
