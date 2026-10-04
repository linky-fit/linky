export interface VideoEmbedProps {
  /** The player's embed URL, e.g. `https://www.youtube-nocookie.com/embed/<id>`. */
  src: string;
  /** Names the player for assistive technology. */
  title: string;
}

/** Embedded players are web pages; native apps link to the video instead. */
export const VideoEmbed: (props: VideoEmbedProps) => null = () => null;
