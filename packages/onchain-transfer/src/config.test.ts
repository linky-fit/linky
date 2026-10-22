import {
  AppDataEvent,
  AppDataIdentifier,
  EventId,
  SignedPlainEvent,
  UnixSeconds,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Option } from "effect";
import {
  decodeOnchainConfig,
  isClientVersionSupported,
  onchainConfigDraft,
  type OnchainConfig,
} from "./config";
import {
  DEFAULT_TRANSFER_AMOUNTS,
  ONCHAIN_CONFIG_IDENTIFIER,
} from "./constants";

const config: OnchainConfig = {
  v: 1,
  feeBasisPoints: 100,
  paused: false,
  description: "Transfers within 24 hours.",
  amounts: DEFAULT_TRANSFER_AMOUNTS,
  mintUrl: "https://cashu.cz",
  network: "mainnet",
  explorerUrl: "https://mempool.space",
};

const operator = makeIdentity();

const eventWith = (
  content: string,
  identifier: AppDataIdentifier = ONCHAIN_CONFIG_IDENTIFIER,
): AppDataEvent => {
  const eventId = EventId.make("ab".repeat(32));
  const createdAt = UnixSeconds.make(1_700_000_000);
  const tags = [["d", identifier]];
  return new AppDataEvent({
    eventId,
    author: operator.pubkey,
    identifier,
    tags,
    content,
    createdAt,
    event: new SignedPlainEvent({
      id: eventId,
      pubkey: operator.pubkey,
      created_at: createdAt,
      kind: 30078,
      tags,
      content,
      sig: "cd".repeat(64),
    }),
  });
};

describe("on-chain config", () => {
  it("publishes in the config slot and reads back", () => {
    const draft = onchainConfigDraft(config);
    expect(draft.identifier).toBe("linky.onchain-transfer:config");
    expect(draft.tags).toEqual([]);
    expect(decodeOnchainConfig(eventWith(draft.content))).toEqual(
      Option.some(config),
    );
  });

  it("ignores another slot", () => {
    const content = onchainConfigDraft(config).content;
    expect(
      decodeOnchainConfig(eventWith(content, AppDataIdentifier.make("other"))),
    ).toEqual(Option.none());
  });

  it.each([
    ["not JSON", "{"],
    ["another version", JSON.stringify({ ...config, v: 2 })],
    [
      "a fee above 100 %",
      JSON.stringify({ ...config, feeBasisPoints: 10_001 }),
    ],
    ["a fractional fee", JSON.stringify({ ...config, feeBasisPoints: 1.5 })],
    ["no amounts", JSON.stringify({ ...config, amounts: [] })],
    ["a zero amount", JSON.stringify({ ...config, amounts: [0] })],
    ["an unknown network", JSON.stringify({ ...config, network: "liquid" })],
    [
      "a long description",
      JSON.stringify({ ...config, description: "x".repeat(1001) }),
    ],
    ["a missing mint", JSON.stringify({ ...config, mintUrl: undefined })],
  ])("rejects %s", (_, content) => {
    expect(decodeOnchainConfig(eventWith(content))).toEqual(Option.none());
  });
});

describe("minClientVersion", () => {
  it("round-trips the minimum and rejects one that is no version", () => {
    const withMinimum: OnchainConfig = {
      ...config,
      minClientVersion: "26.10.7",
    };
    expect(
      decodeOnchainConfig(eventWith(onchainConfigDraft(withMinimum).content)),
    ).toEqual(Option.some(withMinimum));
    expect(
      decodeOnchainConfig(
        eventWith(JSON.stringify({ ...config, minClientVersion: "26.10" })),
      ),
    ).toEqual(Option.none());
  });

  it("lets a Linky of the minimum version or newer transfer", () => {
    const withMinimum: OnchainConfig = {
      ...config,
      minClientVersion: "26.10.7",
    };
    expect(isClientVersionSupported(config, "0.0.0")).toBe(true);
    expect(isClientVersionSupported(withMinimum, "26.10.7")).toBe(true);
    expect(isClientVersionSupported(withMinimum, "26.10.12")).toBe(true);
    expect(isClientVersionSupported(withMinimum, "26.11.1")).toBe(true);
    expect(isClientVersionSupported(withMinimum, "27.1.1")).toBe(true);
    expect(isClientVersionSupported(withMinimum, "26.10.6")).toBe(false);
    expect(isClientVersionSupported(withMinimum, "26.9.20")).toBe(false);
    expect(isClientVersionSupported(withMinimum, "test")).toBe(false);
  });
});
