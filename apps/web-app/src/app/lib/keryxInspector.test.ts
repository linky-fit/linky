import { KeryxMetadataInvalid } from "@linky-fit/keryx";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { FEED_URL, ORIGIN, refreshed, trust } from "../../testUtils/keryx";
import { keryxRefreshRows } from "./keryxInspector";

const subscription = {
  origin: ORIGIN,
  trust: trust(),
  identity: { companyName: "Acme" },
  channels: ["news"],
  privateFeeds: [{ url: FEED_URL, closed: false }],
};

describe("keryx inspector rows", () => {
  it("reports a refresh with counts and its verification problems", () => {
    const rows = keryxRefreshRows(
      subscription,
      Result.succeed(
        refreshed({
          privateFeeds: [
            {
              state: { url: FEED_URL, closed: false },
              status: "unavailable",
              reason: `bad signature on ${FEED_URL}`,
              problems: [
                {
                  path: `${FEED_URL}#0`,
                  reason: "signature",
                  keptCachedCopy: false,
                },
              ],
            },
          ],
        }),
      ),
    );
    expect(rows.map((row) => row.tag)).toEqual([
      "keryx.refreshed",
      "keryx.verificationFailed",
    ]);
    expect(rows[0]?.links).toMatchObject({
      company: ORIGIN,
      announcement: ["launch"],
    });
    expect(JSON.stringify(rows)).not.toContain("SECRETTOKEN");
  });

  it("reports a metadata failure as a verification failure", () => {
    const rows = keryxRefreshRows(
      subscription,
      Result.fail(new KeryxMetadataInvalid({ role: "targets", reason: "sig" })),
    );
    expect(rows.map((row) => row.tag)).toEqual([
      "keryx.refreshFailed",
      "keryx.verificationFailed",
    ]);
  });

  it("reports suspension and rebrand", () => {
    expect(
      keryxRefreshRows(
        subscription,
        Result.succeed({ _tag: "Suspended", rootVersion: 4, reason: "x" }),
      ).map((row) => row.tag),
    ).toEqual(["keryx.suspended"]);
    expect(
      keryxRefreshRows(
        subscription,
        Result.succeed({
          _tag: "Rebranded",
          previousIdentity: { companyName: "Acme" },
          identity: { companyName: "Evil" },
        }),
      ).map((row) => row.tag),
    ).toEqual(["keryx.rebranded"]);
  });
});
