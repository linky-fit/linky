import { describe, expect, it } from "vitest";
import { memoryKeyValueStorage } from "../testing/keyValueStorage";
import {
  makeEvoluRelaySettings,
  normalizeEvoluRelayUrl,
} from "./evoluRelaySettings";
import type { LinkyEvoluEvent } from "./linkyEvolu";

const recommended = [
  "wss://evolu.eu.freedomrelay.dev",
  "wss://evolu.linky.fit",
];
const free = "wss://free.evoluhq.com";
const custom = "wss://sync.example.com";
const userKey = "linky.evoluServers.user.v1";
const legacyKey = "linky.evoluServers.v1";
const legacyRemovedKey = "linky.evoluServers.defaultRemoved.v1";
const disabledKey = "linky.evoluServers.disabled.v1";

const open = (
  kv: ReturnType<typeof memoryKeyValueStorage>,
  {
    envDefaults = [],
    hasStoredAccount = false,
    onEvent,
  }: {
    envDefaults?: ReadonlyArray<string>;
    hasStoredAccount?: boolean;
    onEvent?: (event: LinkyEvoluEvent) => void;
  } = {},
) =>
  makeEvoluRelaySettings(kv, {
    envDefaults,
    recommended,
    hasStoredAccount,
    ...(onEvent ? { onEvent } : {}),
  });

describe("normalizeEvoluRelayUrl", () => {
  it.each([
    ["  wss://relay.example/  ", "wss://relay.example"],
    ["wss://relay.example/sync/?a=1#x", "wss://relay.example/sync"],
    ["ws://localhost:4001", "ws://localhost:4001"],
    ["https://relay.example", null],
    ["", null],
    [null, null],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeEvoluRelayUrl(input)).toBe(expected);
  });
});

describe("Evolu relay list", () => {
  it.each([
    { saved: [...recommended, custom], configured: [...recommended, custom] },
    { saved: [custom], configured: [...recommended, custom] },
    { saved: [], configured: recommended },
  ])(
    "keeps the recommended relays when saving $saved and reopening",
    ({ saved, configured }) => {
      const kv = memoryKeyValueStorage();
      open(kv).setUrls(saved);
      const reopened = open(kv);
      expect(reopened.configuredUrls()).toEqual(configured);
      expect(configured.map(reopened.isRecommended)).toEqual(
        configured.map((url) => recommended.includes(url)),
      );
    },
  );

  it("drops disabled relays from the active ones until enabled again", () => {
    const kv = memoryKeyValueStorage();
    const settings = open(kv);
    settings.setDisabled(`${recommended[0]}/`, true);
    expect(kv.getItem(disabledKey)).toBe(JSON.stringify([recommended[0]]));
    expect(settings.activeUrls()).toEqual([recommended[1]]);
    settings.setDisabled(recommended[0].toUpperCase(), false);
    expect(settings.activeUrls()).toEqual(recommended);
  });

  it("uses the environment relays instead of the recommendation", () => {
    const settings = open(memoryKeyValueStorage(), {
      envDefaults: ["ws://localhost:4001"],
    });
    expect(settings.configuredUrls()).toEqual(["ws://localhost:4001"]);
  });
});

describe("upgrade to recommended relays", () => {
  it("keeps the untouched old defaults that are not recommended as the user's", () => {
    const kv = memoryKeyValueStorage();
    const events: LinkyEvoluEvent[] = [];
    const settings = open(kv, {
      hasStoredAccount: true,
      onEvent: (event) => events.push(event),
    });
    expect(kv.getItem(userKey)).toBe(JSON.stringify([free]));
    expect(settings.activeUrls()).toEqual([...recommended, free]);
    expect(events).toEqual([
      {
        _tag: "UserRelaysMigrated",
        legacyServerUrls: [],
        defaultsRemoved: false,
        isExistingInstall: true,
      },
    ]);
  });

  it("keeps a customized selection without the recommended relays", () => {
    const kv = memoryKeyValueStorage({
      [legacyKey]: JSON.stringify([custom, recommended[1]]),
      [legacyRemovedKey]: "true",
    });
    expect(open(kv).activeUrls()).toEqual([...recommended, custom]);
    expect(kv.getItem(userKey)).toBe(JSON.stringify([custom]));
  });

  it("adds nothing of the user's on a fresh install", () => {
    const kv = memoryKeyValueStorage();
    expect(open(kv).activeUrls()).toEqual(recommended);
    expect(kv.getItem(userKey)).toBe("[]");
  });

  it("migrates once and keeps disabled relays offline", () => {
    const kv = memoryKeyValueStorage({
      [legacyKey]: JSON.stringify([custom]),
      [legacyRemovedKey]: "true",
      [disabledKey]: JSON.stringify([recommended[0]]),
    });
    open(kv);
    kv.setItem(legacyKey, JSON.stringify([free]));
    const events: LinkyEvoluEvent[] = [];
    const settings = open(kv, { onEvent: (event) => events.push(event) });
    expect(settings.activeUrls()).toEqual([recommended[1], custom]);
    expect(events).toEqual([]);
  });

  it("does not keep the old defaults when the environment overrides them", () => {
    const kv = memoryKeyValueStorage();
    open(kv, { envDefaults: ["ws://localhost:4001"], hasStoredAccount: true });
    expect(kv.getItem(userKey)).toBe("[]");
  });
});
