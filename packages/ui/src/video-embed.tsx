import type { ReactElement } from "react";
import type { VideoEmbedProps } from "./video-embed-props";

export type { VideoEmbedProps } from "./video-embed-props";

/** The props every platform's VideoEmbed takes; `video-embed.web.tsx` and `.native.tsx` render it. */
export const VideoEmbed: (props: VideoEmbedProps) => ReactElement | null = () =>
  null;
