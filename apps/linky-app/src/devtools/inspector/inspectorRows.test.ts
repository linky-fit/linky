import { describe, expect, it } from "vitest";

import {
  inspectorLinkIds,
  isInspectorChannel,
  parseInspectorRow,
} from "./inspectorRows";

const baseRow = {
  at: 1_700_000_000_000,
  channel: "cashu.wire",
  tag: "QuoteCreated",
  summary: "created quote",
  links: {},
  payload: null,
};

describe("inspector rows", () => {
  it("accepts lowercase dotted channels and rejects invalid structures", () => {
    expect(isInspectorChannel("cashu.wire")).toBe(true);
    expect(isInspectorChannel("wire")).toBe(true);

    for (const channel of [
      "Cashu.wire",
      "cashu_wire",
      "cashu..wire",
      ".cashu",
      "cashu.",
      "cashu.2wire",
      "",
    ]) {
      expect(isInspectorChannel(channel)).toBe(false);
      expect(parseInspectorRow({ ...baseRow, channel })).toBeNull();
    }
  });

  it("keeps valid novel link labels and drops invalid entries leniently", () => {
    expect(
      parseInspectorRow({
        ...baseRow,
        links: {
          quote: "quote-1",
          proof: ["proof-1", "", 42],
          empty: "",
          invalid: 42,
        },
      }),
    ).toMatchObject({
      links: { quote: "quote-1", proof: ["proof-1"] },
    });
  });

  it("maps legacy link fields and relay context", () => {
    expect(
      parseInspectorRow({
        ...baseRow,
        channel: "wire",
        links: {
          wrapIds: ["wrap-1", "wrap-2"],
          rumorId: "rumor-1",
          clientId: "client-1",
          relay: "wss://relay.test",
        },
      }),
    ).toEqual({
      ...baseRow,
      channel: "wire",
      links: {
        wrap: ["wrap-1", "wrap-2"],
        rumor: "rumor-1",
        client: "client-1",
      },
      context: { relay: "wss://relay.test" },
    });
  });

  it("never includes context values in correlation ids", () => {
    const row = {
      ...baseRow,
      links: { quote: "quote-1", token: ["token-1", "token-2"] },
      context: { mint: "https://mint.test", relay: "wss://relay.test" },
    };

    expect(inspectorLinkIds(row.links)).toEqual([
      "quote-1",
      "token-1",
      "token-2",
    ]);
    expect(inspectorLinkIds(row.links)).not.toContain(row.context.mint);
    expect(inspectorLinkIds(row.links)).not.toContain(row.context.relay);
  });
});
