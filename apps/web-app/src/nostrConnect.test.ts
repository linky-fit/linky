import { makeIdentity } from "@linky-fit/linkstr/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeNostrConnectSite,
  parseNostrConnectUri,
  readNostrConnectUriFromHash,
  takeNostrConnectHashLink,
} from "./nostrConnect";
import { parseRouteFromHash } from "./types/route";

const CLIENT = makeIdentity().pubkey;
const uri = (query: string) =>
  `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Frelay.example.com&secret=s3cr3t${query}`;
const URI = uri("");

describe("readNostrConnectUriFromHash", () => {
  it("reads a raw URI and keeps its query encoded", () => {
    expect(readNostrConnectUriFromHash(`#${URI}`)).toBe(URI);
  });

  it("decodes a percent-encoded URI once", () => {
    expect(readNostrConnectUriFromHash(`#${encodeURIComponent(URI)}`)).toBe(
      URI,
    );
  });

  it("ignores malformed encodings and app routes", () => {
    expect(readNostrConnectUriFromHash("#nostrconnect%3A%E0%A4%A")).toBeNull();
    expect(readNostrConnectUriFromHash("#nostrconnectx")).toBeNull();
    expect(readNostrConnectUriFromHash("#wallet")).toBeNull();
    expect(readNostrConnectUriFromHash("#contacts")).toBeNull();
    expect(readNostrConnectUriFromHash("")).toBeNull();
  });
});

describe("a nostrconnect web link", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("routes to the wallet before its hash is taken", () => {
    window.history.replaceState(null, "", `/#${URI}`);
    expect(parseRouteFromHash()).toEqual({ kind: "wallet" });
  });

  it("is taken out of the address bar, leaving the wallet route", () => {
    window.history.replaceState(null, "", `/?ref=x#${URI}`);
    const length = window.history.length;

    expect(takeNostrConnectHashLink()).toBe(URI);
    expect(window.location.search).toBe("?ref=x");
    expect(window.location.hash).toBe("#wallet");
    expect(window.history.length).toBe(length);
    expect(takeNostrConnectHashLink()).toBeNull();
  });
});

describe("describeNostrConnectSite", () => {
  const describeUri = (query: string) => {
    const request = parseNostrConnectUri(uri(query));
    if (!request) throw new Error("fixture URI did not parse");
    return describeNostrConnectSite(request);
  };

  it("labels the site with its claimed name and shows the claimed host", () => {
    expect(
      describeUri("&name=Example&url=https%3A%2F%2Fapp.example.com%2Flogin"),
    ).toEqual({ host: "app.example.com", label: "Example" });
  });

  it("falls back to the host, then to nothing", () => {
    expect(describeUri("&url=https%3A%2F%2Fexample.com")).toEqual({
      host: "example.com",
      label: "example.com",
    });
    expect(describeUri("&url=not%20a%20url")).toEqual({
      host: null,
      label: null,
    });
  });
});
