import { Registry } from "./index";
import { BadgeDefinition } from "@linky-fit/linkstr";
import { Exit } from "effect";
import { linkstrConfigAtom } from "./config";
import {
  profileWatchAtom,
  profileWatchHandlerAtom,
  watchedProfilesAtom,
} from "./profiles";
import {
  fetchOwnProfileBadgesAtom,
  publishBadgeDefinitionAtom,
  publishProfileBadgeAtom,
} from "./supporterBadges";
import {
  configWith,
  fakeTransportLayer,
  makeIdentity,
  settle,
} from "./testing";
import type { FakeSubscription, PublishedEvent } from "./testing";

const bot = makeIdentity();
const supporter = makeIdentity();

describe("supporter badge atoms", () => {
  it("publish definitions and profile badges through the configured transport", async () => {
    const registry = Registry.make();
    const published: Array<PublishedEvent> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(supporter, fakeTransportLayer(published, [])),
    );

    registry.set(
      publishBadgeDefinitionAtom,
      new BadgeDefinition({
        badge: "generic",
        name: "Linky supporter",
        description: "",
        image: "https://linky.test/badge.png",
        thumb: "https://linky.test/badge-thumb.png",
      }),
    );
    expect(
      Exit.isSuccess(await settle(registry, publishBadgeDefinitionAtom)),
    ).toBe(true);

    registry.set(publishProfileBadgeAtom, { issuer: bot.pubkey, award: null });
    expect(
      Exit.isSuccess(await settle(registry, publishProfileBadgeAtom)),
    ).toBe(true);

    registry.set(fetchOwnProfileBadgesAtom, undefined);
    expect(await settle(registry, fetchOwnProfileBadgesAtom)).toEqual(
      Exit.succeed(null),
    );
    expect(published.map((event) => event.kind)).toEqual([30009, 30008]);
  });
});

describe("profileWatchAtom options", () => {
  it("passes the supporter badge issuer through to the watch", async () => {
    const registry = Registry.make();
    const subscriptions: Array<FakeSubscription> = [];
    registry.set(
      linkstrConfigAtom,
      configWith(supporter, fakeTransportLayer([], subscriptions)),
    );
    registry.set(profileWatchHandlerAtom, {
      onEvent: () => {},
      options: { supporterBadgeIssuer: bot.pubkey },
    });
    registry.set(watchedProfilesAtom, [supporter.pubkey]);
    const unmount = registry.mount(profileWatchAtom);

    await expect
      .poll(() => subscriptions.map(({ filter }) => filter.kinds?.[0]))
      .toEqual([0, 30315, 30008]);
    unmount();
  });
});
