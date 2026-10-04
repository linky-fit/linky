import { Either, Option } from "effect";
import { parseJoinUrl } from "./index";

const payload = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const left = (url: string) =>
  Option.getOrNull(Either.getLeft(parseJoinUrl(url)));

describe("parseJoinUrl", () => {
  it("decodes a v1 payload and ignores unknown members", () => {
    const p = payload({
      v: 1,
      channels: ["news"],
      private_feeds: ["https://shop.example/channels/tracking/t/feed.json"],
      company_name: "Not shown",
    });
    expect(parseJoinUrl(`https://Company.Example/join?p=${p}`)).toEqual(
      Either.right({
        origin: "https://company.example",
        channels: ["news"],
        privateFeeds: ["https://shop.example/channels/tracking/t/feed.json"],
      }),
    );
  });

  it("returns the origin as punycode", () => {
    expect(
      Either.getOrThrow(parseJoinUrl("https://bücher.example/join")).origin,
    ).toBe("https://xn--bcher-kva.example");
  });

  it.each([
    "https://acme.example",
    "https://acme.example/",
    "https://acme.example/join",
    "https://acme.example/join/",
  ])("accepts a payload-less join at %s", (url) => {
    expect(parseJoinUrl(url)).toEqual(
      Either.right({
        origin: "https://acme.example",
        channels: [],
        privateFeeds: [],
      }),
    );
  });

  it.each([
    "https://acme.example/news",
    "https://acme.example/join/x",
    "https://acme.example/blog/join",
  ])("rejects a payload-less URL at another path: %s", (url) => {
    expect(left(url)?._tag).toBe("KeryxJoinUrlInvalid");
  });

  it("tells an unknown payload version apart", () => {
    expect(
      left(`https://acme.example/join?p=${payload({ v: 2, anything: true })}`),
    ).toEqual(
      expect.objectContaining({
        _tag: "KeryxJoinVersionUnsupported",
        version: 2,
      }),
    );
  });

  it.each([
    ["plain http", "http://acme.example/join"],
    ["a custom scheme", "keryx://acme.example/join"],
    ["padded base64", `https://acme.example/join?p=${payload({ v: 1 })}==`],
    [
      "standard base64",
      `https://acme.example/join?p=${Buffer.from('{"v":1,"channels":["a"]}???').toString("base64")}`,
    ],
    [
      "a payload without v",
      `https://acme.example/join?p=${payload({ channels: [] })}`,
    ],
    [
      "an invalid channel name",
      `https://acme.example/join?p=${payload({ v: 1, channels: ["News"] })}`,
    ],
    [
      "a non-HTTPS private feed",
      `https://acme.example/join?p=${payload({ v: 1, private_feeds: ["http://x.example/f"] })}`,
    ],
    ["credentials", "https://user:pw@acme.example/join"],
  ])("rejects %s", (_, url) => {
    expect(left(url)?._tag).toBe("KeryxJoinUrlInvalid");
  });

  it("accepts plain http only on loopback", () => {
    expect(Either.isRight(parseJoinUrl("http://localhost:8080/join"))).toBe(
      true,
    );
    expect(Either.isRight(parseJoinUrl("http://127.0.0.1/join"))).toBe(true);
  });
});
