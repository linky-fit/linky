import { createId } from "@linky-fit/domain";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { describe, expect, it } from "vitest";
import {
  chatRoute,
  parseRoute,
  routeHash,
  transferRoute,
  type Route,
} from "./routing";

describe("routing", () => {
  it("round-trips every route through its hash", () => {
    const routes: Route[] = [
      transferRoute(createId<"OnchainTransfer">()),
      chatRoute(makeIdentity().pubkey),
      { section: "transfers", transferId: null },
      { section: "chats", peer: null },
      { section: "wallet" },
      { section: "stats" },
      { section: "settings" },
    ];
    for (const route of routes)
      expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it("opens the transfer list for an unknown or malformed hash", () => {
    expect(parseRoute("")).toEqual({ section: "transfers", transferId: null });
    expect(parseRoute("#nope")).toEqual({
      section: "transfers",
      transferId: null,
    });
    expect(parseRoute("#chats/not-a-key")).toEqual({
      section: "chats",
      peer: null,
    });
  });
});
