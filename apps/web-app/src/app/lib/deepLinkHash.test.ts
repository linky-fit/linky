import { afterEach, describe, expect, it } from "vitest";
import { buildCashuToken } from "../../testUtils/cashuToken";
import {
  PENDING_DEEP_LINK_TEXT_STORAGE_KEY,
  PENDING_ONBOARDER_NPUB_STORAGE_KEY,
} from "../../utils/constants";
import { parkDeepLinkFromHash } from "./deepLinkHash";

const token = buildCashuToken();
const npub = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";

const replaceHash = (hash: string) => {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
};

const stored = (key: string) => window.localStorage.getItem(key);

afterEach(() => {
  replaceHash("");
  window.localStorage.removeItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY);
  window.localStorage.removeItem(PENDING_ONBOARDER_NPUB_STORAGE_KEY);
});

describe("parkDeepLinkFromHash", () => {
  it("parks a cashu token as a pending deep link and strips the query", () => {
    replaceHash(`#wallet?cashu=${token}`);

    parkDeepLinkFromHash();

    expect(stored(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBe(`cashu:${token}`);
    expect(stored(PENDING_ONBOARDER_NPUB_STORAGE_KEY)).toBeNull();
    expect(window.location.hash).toBe("#wallet");
  });

  it("parks the onboarder npub next to the gift token", () => {
    replaceHash(`#wallet?onboarder=${npub}&cashu=${token}`);

    parkDeepLinkFromHash();

    expect(stored(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBe(`cashu:${token}`);
    expect(stored(PENDING_ONBOARDER_NPUB_STORAGE_KEY)).toBe(npub);
    expect(window.location.hash).toBe("#wallet");
  });

  it("parks an onboarder without a gift", () => {
    replaceHash(`#wallet?onboarder=${npub}`);

    parkDeepLinkFromHash();

    expect(stored(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBeNull();
    expect(stored(PENDING_ONBOARDER_NPUB_STORAGE_KEY)).toBe(npub);
  });

  it("leaves hashes without deep-link data alone", () => {
    replaceHash("#wallet/tokens");

    parkDeepLinkFromHash();

    expect(stored(PENDING_DEEP_LINK_TEXT_STORAGE_KEY)).toBeNull();
    expect(window.location.hash).toBe("#wallet/tokens");
  });
});
