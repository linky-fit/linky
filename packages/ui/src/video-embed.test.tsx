import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { VideoEmbed } from "./video-embed";

describe("VideoEmbed", () => {
  it("embeds the player with its accessible title", async () => {
    const frame = (
      await render(
        <VideoEmbed src="https://player.example/embed/1" title="Demo video" />,
      )
    ).querySelector("iframe");
    expect(frame?.getAttribute("src")).toBe("https://player.example/embed/1");
    expect(frame?.getAttribute("title")).toBe("Demo video");
  });
});
