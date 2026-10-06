import { Effect, Exit, Fiber, Layer } from "effect";
import type { Event as NostrToolsEvent, Filter } from "nostr-tools";
import { RelayUrl } from "../domain/primitives";
import { LinkstrIdentity } from "../services/LinkstrIdentity";
import { NostrTransport, RelayPublishResult } from "../services/NostrTransport";
import type { NostrTransportService } from "../services/NostrTransport";
import { makeIdentity } from "../testing";
import { NostrConnectClientDraft } from "./client";
import {
  DEVICE_AUTHORIZATION_PERMISSION,
  deviceAuthorizationTemplate,
  parseNostrConnectUri,
  verifyDeviceAuthorization,
} from "./codec";
import { NostrConnect } from "./NostrConnect";
import { NostrConnectClient } from "./NostrConnectClient";

const employee = makeIdentity();
const device = makeIdentity();
const relay = RelayUrl.make("wss://relay.test");

const matches = (filter: Filter, event: NostrToolsEvent): boolean =>
  (filter.kinds?.includes(event.kind) ?? true) &&
  (filter.authors?.includes(event.pubkey) ?? true) &&
  (filter["#p"]?.some((pubkey) =>
    event.tags.some((tag) => tag[0] === "p" && tag[1] === pubkey),
  ) ??
    true);

/** One relay both sides share: a publish reaches every open matching subscription. */
const relayBus = (): NostrTransportService => {
  const listeners = new Set<{
    filter: Filter;
    onEvent: (event: NostrToolsEvent) => void;
  }>();
  return {
    publish: (relays, event) =>
      Effect.sync(() => {
        for (const listener of [...listeners]) {
          if (matches(listener.filter, event)) listener.onEvent(event);
        }
        return relays.map(
          (url) =>
            new RelayPublishResult({
              relay: url,
              accepted: true,
              detail: null,
            }),
        );
      }),
    subscribe: (_relay, filter, onEvent, options) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const listener = { filter, onEvent };
          listeners.add(listener);
          options?.onEose?.();
          return listener;
        }),
        (listener) => Effect.sync(() => listeners.delete(listener)),
      ).pipe(Effect.andThen(Effect.never), Effect.scoped),
    fetch: () => Effect.succeed([]),
  };
};

const runBoth = <A, E>(
  program: Effect.Effect<A, E, NostrConnect | NostrConnectClient>,
): Promise<Exit.Exit<A, E>> => {
  const transport = Layer.succeed(NostrTransport, relayBus());
  const layer = Layer.mergeAll(
    NostrConnect.Default.pipe(
      Layer.provide(LinkstrIdentity.fromSecretKey(employee.secretKey)),
    ),
    NostrConnectClient.Default,
  ).pipe(Layer.provide(transport));
  return Effect.runPromiseExit(program.pipe(Effect.provide(layer)));
};

const draft = new NostrConnectClientDraft({
  relays: [relay],
  perms: [DEVICE_AUTHORIZATION_PERMISSION],
  name: "Platit prosím",
  url: "https://platitprosim.cz",
});

describe("NostrConnectClient", () => {
  it("builds a link Linky's signer parses, with the permission and name it shows", () =>
    runBoth(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* (yield* NostrConnectClient).open(draft);
          expect(parseNostrConnectUri(session.uri)).toMatchObject({
            clientPubkey: session.clientPubkey,
            relays: [relay],
            perms: [DEVICE_AUTHORIZATION_PERMISSION],
            name: "Platit prosím",
            url: "https://platitprosim.cz",
          });
        }),
      ),
    ).then((exit) => expect(Exit.isSuccess(exit)).toBe(true)));

  it("gets a device authorization signed by the user's signer, end to end", async () => {
    const exit = await runBoth(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* (yield* NostrConnectClient).open(draft);
          const request = parseNostrConnectUri(session.uri);
          assert(request !== null);
          const login = yield* Effect.fork(
            (yield* NostrConnect).login(request),
          );
          expect(yield* session.connected).toBe(employee.pubkey);
          const signed = yield* session.signEvent(
            deviceAuthorizationTemplate({
              device: device.pubkey,
              app: "Platit prosím",
            }),
          );
          return { signed, receipt: yield* Fiber.join(login) };
        }),
      ),
    );

    assert(Exit.isSuccess(exit));
    const { signed, receipt } = exit.value;
    expect(receipt.authorizedDevice).toBe(device.pubkey);
    expect(verifyDeviceAuthorization(JSON.stringify(signed))).toMatchObject({
      author: employee.pubkey,
      device: device.pubkey,
      app: "Platit prosím",
    });
  });

  it("fails NostrConnectSignRefused when the signer refuses the request", async () => {
    const exit = await runBoth(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* (yield* NostrConnectClient).open(draft);
          const request = parseNostrConnectUri(session.uri);
          assert(request !== null);
          yield* Effect.fork(
            Effect.either((yield* NostrConnect).login(request)),
          );
          return yield* Effect.either(
            session.signEvent(
              deviceAuthorizationTemplate({
                device: device.pubkey,
                app: "Another app",
              }),
            ),
          );
        }),
      ),
    );

    assert(Exit.isSuccess(exit));
    assert(exit.value._tag === "Left");
    expect(exit.value.left).toMatchObject({
      _tag: "NostrConnectSignRefused",
      reason: "app tag does not match the approved name",
    });
  });
});
