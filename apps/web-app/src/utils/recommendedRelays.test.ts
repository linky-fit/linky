import { expect, it } from "vitest";
import {
  loadRecommendedRelays,
  saveRecommendedRelays,
  withFetchedRecommendedRelays,
} from "./recommendedRelays";

it("retires Nostr relays the endpoint stops recommending until it lists them again", () => {
  const first = withFetchedRecommendedRelays(
    {
      nostr: ["wss://a.example", "wss://b.example"],
      evolu: [],
      retiredNostr: [],
    },
    { nostr: ["wss://a.example"], evolu: ["wss://evolu.example"] },
  );
  expect(first).toEqual({
    nostr: ["wss://a.example"],
    evolu: ["wss://evolu.example"],
    retiredNostr: ["wss://b.example"],
  });
  expect(
    withFetchedRecommendedRelays(first, {
      nostr: ["wss://b.example"],
      evolu: [],
    }).retiredNostr,
  ).toEqual(["wss://a.example"]);
});

it("persists the fetched recommendation", () => {
  localStorage.clear();
  const relays = { nostr: ["wss://a.example"], evolu: [], retiredNostr: [] };
  saveRecommendedRelays(relays);
  expect(loadRecommendedRelays()).toEqual(relays);
});
