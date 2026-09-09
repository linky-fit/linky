import { afterEach, describe, expect, it } from "vitest";
import { buildCashuToken } from "../../testUtils/cashuToken";
import { PENDING_DEEP_LINK_TEXT_STORAGE_KEY } from "../../utils/constants";
import {
  consumeCashuTokenFromHash,
  parkCashuTokenFromHashForLogin,
} from "./cashuHashDeepLink";

const token = buildCashuToken();

const replaceHash = (hash: string) => {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${hash}`,
  );
};

afterEach(() => {
  replaceHash("");
  window.localStorage.removeItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY);
});

describe("consumeCashuTokenFromHash", () => {
  it("returns the token and strips the query from the hash", () => {
    replaceHash(`#wallet?cashu=${token}`);

    expect(consumeCashuTokenFromHash()).toBe(token);
    expect(window.location.hash).toBe("#wallet");
  });

  it("ignores hashes without a cashu query", () => {
    replaceHash("#wallet/tokens");

    expect(consumeCashuTokenFromHash()).toBeNull();
    expect(window.location.hash).toBe("#wallet/tokens");
  });
});

describe("parkCashuTokenFromHashForLogin", () => {
  it("stores the token as a pending deep link for the authenticated shell", () => {
    replaceHash(`#wallet?cashu=${token}`);

    parkCashuTokenFromHashForLogin();

    expect(
      window.localStorage.getItem(PENDING_DEEP_LINK_TEXT_STORAGE_KEY),
    ).toBe(`cashu:${token}`);
    expect(window.location.hash).toBe("#wallet");
  });
});
