import { MintUrl } from "@linky-fit/linkshu";
import {
  OutboxJobFailed,
  OutboxJobId,
  OutboxJobSucceeded,
  OutboxRef,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createCashuSends } from "./cashuSends";
import { fakeNostr, fakeWallet, testMint } from "./testing/fakes";

const hex = makeIdentity().pubkey;

const setup = (nip05: (url: string) => Response | Error) => {
  const nostr = fakeNostr();
  const wallet = fakeWallet();
  const asked: string[] = [];
  const sends = createCashuSends({
    wallet: wallet.wallet,
    nostr: nostr.nostr,
    nip05Fetch: async (input) => {
      asked.push(String(input));
      const answer = nip05(String(input));
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
  const settle = async (result: OutboxJobSucceeded | OutboxJobFailed) => {
    for (const { refPrefix, handler } of nostr.outbox)
      if (result.ref.startsWith(refPrefix)) await handler(result);
  };
  return { sends, nostr, wallet, asked, settle };
};

const json = (body: unknown) => new Response(JSON.stringify(body));
const source = { mint: MintUrl.make(testMint), sats: 1_000 };

describe("resolveName", () => {
  it("finds the account and its relays behind a Linky name", async () => {
    const { sends, asked } = setup(() =>
      json({
        names: { hynek: hex },
        relays: { [hex]: ["wss://nos.lol", "not a relay"] },
      }),
    );
    expect(await sends.resolveName("hynek")).toEqual(
      Result.succeed({ pubkey: hex, relays: ["wss://nos.lol"] }),
    );
    expect(asked).toEqual([
      "https://linky.fit/.well-known/nostr.json?name=hynek",
    ]);
  });

  it("tells an unknown name from a failed lookup", async () => {
    expect(
      await setup(() => json({ names: {} })).sends.resolveName("nobody"),
    ).toEqual(Result.fail({ reason: "nameNotFound" }));
    expect(
      await setup(() => new Error("offline")).sends.resolveName("hynek"),
    ).toEqual(Result.fail({ reason: "lookupFailed" }));
  });
});

describe("send", () => {
  it("sends a token to the recipient and closes the send once a relay took it", async () => {
    const { sends, nostr, wallet, settle } = setup(() => json({}));
    expect(await sends.send({ pubkey: hex, relays: [] }, source, 210)).toEqual(
      Result.succeed(undefined),
    );
    expect(wallet.sent).toEqual([{ amount: 210, forRequest: false }]);
    const [token] = nostr.tokens;
    expect(token?.to).toBe(hex);
    await settle(
      Schema.decodeUnknownSync(OutboxJobSucceeded)({
        _tag: "OutboxJobSucceeded",
        jobId: "job",
        ref: token?.ref,
        receipt: {
          _tag: "AppMessageReceipt",
          rumorId: "00".repeat(32),
          clientId: "client",
          sentAt: 1_700_000_000,
          recipientCopy: {
            wrapId: "11".repeat(32),
            acceptedBy: [],
            rejectedBy: [],
          },
        },
      }),
    );
    expect(wallet.forgotten).toEqual(["send-1"]);
  });

  it("takes the token back when its message never left", async () => {
    const { sends, nostr, wallet, settle } = setup(() => json({}));
    await sends.send({ pubkey: hex, relays: [] }, source, 210);
    await settle(
      new OutboxJobFailed({
        jobId: OutboxJobId.make("job"),
        ref: OutboxRef.make(nostr.tokens[0]?.ref ?? ""),
        reason: "unexpected-error",
        detail: "",
      }),
    );
    expect(wallet.returned).toEqual(["send-1"]);
  });
});
