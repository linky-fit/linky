import { isLinkauthLink } from "@linky-fit/linkauth/signer";
import { parseNostrConnectUri } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeSiteLogin,
  readNostrConnectUriFromHash,
  takeSiteLoginHashLink,
  type SiteLoginRequest,
} from "./siteLogin";
import {
  CALLBACK_URL,
  callbackLogin,
  linkauthFragment,
  nostrLogin,
} from "./testUtils/siteLoginFixtures";
import { parseRouteFromHash } from "./types/route";

const CLIENT = makeIdentity().pubkey;
const uri = (query: string) =>
  `nostrconnect://${CLIENT}?relay=wss%3A%2F%2Frelay.example.com&secret=s3cr3t${query}`;
const URI = uri("");
const LINKAUTH = linkauthFragment({ cb: CALLBACK_URL });

const relayLogin = (query: string): SiteLoginRequest => {
  const request = parseNostrConnectUri(uri(query));
  if (!request) throw new Error("fixture URI did not parse");
  return { channel: "relay", request };
};

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

describe("a site login web link", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it.each([
    ["nostrconnect", URI],
    ["linkauth", LINKAUTH],
  ])("%s routes to the wallet before its hash is taken", (_name, link) => {
    window.history.replaceState(null, "", `/#${link}`);
    expect(parseRouteFromHash()).toEqual({ kind: "wallet" });
  });

  it.each([
    ["nostrconnect", URI],
    ["linkauth", LINKAUTH],
  ])(
    "%s is taken out of the address bar, leaving the wallet route",
    (_name, link) => {
      window.history.replaceState(null, "", `/?ref=x#${link}`);
      const length = window.history.length;

      expect(takeSiteLoginHashLink()).toBe(link);
      expect(window.location.search).toBe("?ref=x");
      expect(window.location.hash).toBe("#wallet");
      expect(window.history.length).toBe(length);
      expect(takeSiteLoginHashLink()).toBeNull();
    },
  );

  it("hands a linkauth link on as the signer reads it", () => {
    window.history.replaceState(null, "", `/#${LINKAUTH}`);

    expect(isLinkauthLink(takeSiteLoginHashLink() ?? "")).toBe(true);
  });

  it("leaves other hashes alone", () => {
    window.history.replaceState(null, "", "/#contacts");

    expect(takeSiteLoginHashLink()).toBeNull();
    expect(window.location.hash).toBe("#contacts");
  });
});

describe("describeSiteLogin", () => {
  it.each([
    ["callback", callbackLogin(), false],
    ["nostr", nostrLogin(), true],
  ])(
    "shows a verified %s login with the document's name and icon",
    (_name, login, fromOtherScreen) => {
      expect(describeSiteLogin({ channel: "linkauth", login })).toEqual({
        audience: "https://shop.example",
        name: "Shop",
        image: "https://shop.example/icon.png",
        verified: true,
        linksDevice: false,
        fromOtherScreen,
      });
    },
  );

  it("binds a relay request to the origin of its url when it asks for the login permission", () => {
    expect(
      describeSiteLogin(
        relayLogin(
          "&name=Example&perms=sign_event%3A24139&url=https%3A%2F%2Fapp.example.com%2Flogin",
        ),
      ),
    ).toEqual({
      audience: "https://app.example.com",
      name: "Example",
      image: null,
      verified: false,
      linksDevice: false,
      fromOtherScreen: true,
    });
  });

  it.each([
    ["no url", "&perms=sign_event%3A24139"],
    ["a url that is not a site", "&perms=sign_event%3A24139&url=not%20a%20url"],
    ["no permissions", "&url=https%3A%2F%2Fexample.com"],
    [
      "only a blanket sign_event",
      "&perms=sign_event&url=https%3A%2F%2Fexample.com",
    ],
    [
      "a different kind",
      "&perms=sign_event%3A22242&url=https%3A%2F%2Fexample.com",
    ],
  ])("has no audience for a relay request with %s", (_name, query) => {
    expect(describeSiteLogin(relayLogin(query)).audience).toBeNull();
  });

  it("announces a device link only for the explicit permission", () => {
    const perms = "sign_event%3A24139%2Csign_event%3A24138";
    expect(
      describeSiteLogin(
        relayLogin(`&perms=${perms}&url=https%3A%2F%2Fexample.com&name=App`),
      ).linksDevice,
    ).toBe(true);
  });
});
