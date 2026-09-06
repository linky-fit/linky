import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  deriveCashuMnemonicFromMasterSecret,
  deriveOwnerMnemonicsFromMasterSecret,
  parseOwnerLaneIndex,
  type OwnerMnemonicRequest,
} from "./derive";
import { MasterSecret } from "./domain";

const TEST_SEED = MasterSecret.make(
  new Uint8Array(Array.from({ length: 64 }, (_, i) => (i + 1) % 256)),
);

describe("identity derivation", () => {
  it("parses valid owner lane indexes and rejects invalid ones", async () => {
    const valid = await Effect.runPromise(parseOwnerLaneIndex(7));
    expect(valid).toBe(7);

    await expect(Effect.runPromise(parseOwnerLaneIndex(-1))).rejects.toThrow();
    await expect(
      Effect.runPromise(parseOwnerLaneIndex(Number.NaN)),
    ).rejects.toThrow();
  });

  it("derives one 12-word mnemonic per requested owner lane", async () => {
    const index = await Effect.runPromise(parseOwnerLaneIndex(2));
    const [lane0, lane2] = await Effect.runPromise(
      deriveOwnerMnemonicsFromMasterSecret(TEST_SEED, [
        { role: "contacts" },
        { role: "contacts", index },
      ]),
    );

    expect(lane0?.split(/\s+/)).toHaveLength(12);
    expect(lane2?.split(/\s+/)).toHaveLength(12);
    expect(lane0).not.toBe(lane2);
  });

  it("keeps the error tracker owner deterministic and separate from app lanes", async () => {
    const requests = [
      { role: "meta" },
      { role: "identity" },
      { role: "contacts" },
      { role: "cashu" },
      { role: "transactions" },
      { role: "messages" },
      { role: "errorTracker" },
    ] satisfies OwnerMnemonicRequest[];
    const mnemonics = await Effect.runPromise(
      deriveOwnerMnemonicsFromMasterSecret(TEST_SEED, requests),
    );
    const [tracker] = await Effect.runPromise(
      deriveOwnerMnemonicsFromMasterSecret(TEST_SEED, [
        { role: "errorTracker" },
      ]),
    );
    expect(tracker).toBe(
      "decorate business lift trust month music sentence lottery music crush silent forward",
    );
    expect(tracker).toBe(mnemonics.at(-1));
    expect(new Set(mnemonics).size).toBe(requests.length);
    expect(tracker?.split(/\s+/)).toHaveLength(12);
  });

  it("derives deterministic cashu mnemonic from master secret", async () => {
    const a = await Effect.runPromise(
      deriveCashuMnemonicFromMasterSecret(TEST_SEED),
    );
    const b = await Effect.runPromise(
      deriveCashuMnemonicFromMasterSecret(TEST_SEED),
    );
    expect(a).toBe(b);
    expect(a.split(/\s+/)).toHaveLength(24);
  });
});
