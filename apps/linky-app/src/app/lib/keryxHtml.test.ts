// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeAnnouncementHtml as sanitizeWeb } from "./keryxHtml";
import { sanitizeAnnouncementHtml as sanitizeNative } from "./keryxHtml.native";

describe.each([
  ["web", sanitizeWeb],
  ["native", sanitizeNative],
])("sanitizeAnnouncementHtml (%s)", (_, sanitizeAnnouncementHtml) => {
  const parse = (html: string) =>
    new DOMParser().parseFromString(sanitizeAnnouncementHtml(html), "text/html")
      .body;

  it("drops scripts, event handlers and forms", () => {
    const body = parse(
      '<p onclick="alert(1)">Hi</p><script>alert(1)</script><form><input></form><iframe src="https://x.example"></iframe>',
    );
    expect(body.innerHTML).toBe("<p>Hi</p>");
  });

  it("keeps inline images and removes remote ones", () => {
    const body = parse(
      '<img src="data:image/png;base64,AA" alt="inline"><img src="https://tracker.example/pixel.gif"><img srcset="https://x.example/a.png 2x" src="data:image/png;base64,AA">',
    );
    const images = [...body.querySelectorAll("img")];
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "data:image/png;base64,AA",
      "data:image/png;base64,AA",
    ]);
    expect(images[1]?.hasAttribute("srcset")).toBe(false);
  });

  it("opens links outside the sandbox and shows their real domain", () => {
    const body = parse(
      '<a href="https://evil.example/login">trezor.io</a> <a href="javascript:alert(1)">x</a> <a href="/relative">y</a>',
    );
    const [web, script, relative] = [...body.querySelectorAll("a")];
    expect(web?.textContent).toBe("trezor.io (evil.example)");
    expect(web?.getAttribute("target")).toBe("_blank");
    expect(web?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(script?.hasAttribute("href")).toBe(false);
    expect(relative?.hasAttribute("href")).toBe(false);
  });

  it("drops links it cannot label: SVG, MathML and image map areas", () => {
    const body = parse(
      '<svg><a href="https://evil.example"><text>trezor.io</text></a></svg><math><mi href="https://evil.example">x</mi></math><map><area href="https://evil.example"></map>',
    );
    expect(body.querySelector("[href]")).toBeNull();
  });

  it("drops elements that navigate on their own and unwraps unknown ones", () => {
    const body = parse(
      '<meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><!-- note --><x-card><b>Kept</b></x-card>',
    );
    expect(body.innerHTML).toBe("<b>Kept</b>");
  });
});
