import { Mints, NewProof, parseP2pkPubkey } from "@linky-fit/linkshu";
import { encodeNpub, encodeNsec, type Pubkey } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { RegistryContext } from "@linky-fit/linkstr-react";
import { Effect, Exit, Option, Result, Schema, Scope } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLinkshuComposition } from "../../hooks/composition/useLinkshuComposition";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { INSPECTOR_REPORT_PATH } from "../../../devtools/inspector/inspectorRows";
import { buildCashuToken } from "../../../testUtils/cashuToken";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import type { SessionState } from "../session/session";
import { sessionAtom } from "../session/session";
import { walletRepositoryAtom } from "../session/store";
import { linkshuCommandsAtom } from "./commands";
import { walletReadModelAtom } from "./readModel";
import {
  LinkshuNotConfigured,
  linkshuRuntimeAtom,
  linkshuSeedAtom,
  WalletScope,
} from "./runtime";
import { WalletOpQueue } from "../wallet/opQueue";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));

const calls = vi.hoisted(
  (): { order: string[]; storedCashuMnemonic: string | null } => ({
    order: [],
    storedCashuMnemonic: null,
  }),
);
vi.mock("../../migrations/linkshuStorageMigration", () => ({
  migrateLegacyCashuLocalState: () => calls.order.push("migrate"),
}));
vi.mock("../../../platform/identitySecrets", () => ({
  readStoredCashuMnemonic: () => {
    calls.order.push("readCashuMnemonic");
    return Promise.resolve(calls.storedCashuMnemonic);
  },
  writeStoredCashuMnemonic: (mnemonic: string) => {
    calls.order.push("writeCashuMnemonic");
    calls.storedCashuMnemonic = mnemonic;
    return Promise.resolve();
  },
}));

const APP_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const boot = (
  session: SessionState = signedInSession({ appMnemonic: APP_MNEMONIC }),
) => {
  openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
  return makeTestAppRegistry({ session });
};

const result = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Parameters<typeof AtomRegistry.getResult<A, E>>[1],
) => Effect.runPromise(AtomRegistry.getResult(registry, atom));

const commandsOf = (registry: AtomRegistry.AtomRegistry) =>
  result(registry, linkshuCommandsAtom);

/** Mint calls hang until `release`, then fail as if the mint were offline. */
const gateMints = () => {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn(() =>
    opened.then(() => Promise.reject(new TypeError("Failed to fetch"))),
  );
  // The dev inspector flushes its rows through fetch on a timer; keep them out of the mint count.
  vi.stubGlobal("fetch", (input: RequestInfo | URL) =>
    String(input) === INSPECTOR_REPORT_PATH
      ? Promise.resolve(new Response(null, { status: 204 }))
      : fetch(),
  );
  return { fetch, release };
};

/** A mint answering NUT-06 info, keysets and keys for one v1 keyset. */
const stubMintEndpoints = () => {
  const keysetId = "004cc88c4e270576";
  const keys = {
    "1": "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    "2": "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    "4": "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    "8": "02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13",
  };
  const keyset = {
    id: keysetId,
    unit: "sat",
    active: true,
    input_fee_ppk: 100,
  };
  const bodies: Record<string, unknown> = {
    "/v1/info": {
      name: "Preset mint",
      pubkey: keys["1"],
      version: "Nutshell/0.16.0",
      nuts: { "15": { methods: [{ method: "bolt11", unit: "sat" }] } },
      icon_url: "/icon.png",
    },
    "/v1/keysets": { keysets: [keyset] },
    "/v1/keys": { keysets: [{ ...keyset, keys }] },
  };
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = bodies[new URL(url, "http://localhost").pathname];
    return Promise.resolve(
      new Response(JSON.stringify(body ?? null), {
        status: body === undefined ? 404 : 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
};

const proofAt = (mint: string) =>
  Schema.decodeUnknownSync(NewProof)({
    mint,
    unit: "sat",
    keysetId: "00ab",
    amount: 8,
    secret: `secret-${mint}`,
    C: "02ab",
    dleq: null,
    state: "available",
    operationId: null,
  });

beforeEach(() => {
  calls.order = [];
  calls.storedCashuMnemonic = null;
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("linkshuSeedAtom", () => {
  it("migrates the legacy cashu state before it resolves the seed", async () => {
    const registry = boot(signedInSession());
    await result(registry, linkshuSeedAtom);
    expect(calls.order).toEqual([
      "migrate",
      "readCashuMnemonic",
      "writeCashuMnemonic",
      "readCashuMnemonic",
    ]);
  });

  it("generates a cashu mnemonic once and never replaces it", async () => {
    const registry = boot(signedInSession());
    const seed = await result(registry, linkshuSeedAtom);
    registry.set(sessionAtom, signedInSession({ nsec: "nsec1other" }));
    registry.refresh(linkshuRuntimeAtom);
    await result(registry, linkshuRuntimeAtom);

    expect(await result(registry, linkshuSeedAtom)).toBe(seed);
    expect(calls.order.filter((call) => call === "writeCashuMnemonic")).toEqual(
      ["writeCashuMnemonic"],
    );
  });

  it("is not configured when the session could not read the cashu mnemonic", async () => {
    const registry = boot({
      ...signedInSession({ appMnemonic: APP_MNEMONIC }),
      degraded: true,
      cause: "bridge down",
      unreadable: new Set(["cashuMnemonic"]),
    });

    const exit = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, linkshuSeedAtom),
    );

    expect(exit).toEqual(Exit.fail(new LinkshuNotConfigured()));
    expect(calls.order).not.toContain("writeCashuMnemonic");
  });
});

describe("linkshuRuntimeAtom", () => {
  it("closes the wallet scope when the runtime rebuilds", async () => {
    const registry = boot();
    const closed = vi.fn();
    const context = await result(registry, linkshuRuntimeAtom);
    await Effect.runPromiseWith(context)(
      Effect.flatMap(WalletScope, (scope) =>
        Scope.addFinalizer(scope, Effect.sync(closed)),
      ),
    );

    registry.refresh(linkshuRuntimeAtom);
    await result(registry, linkshuRuntimeAtom);

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("drops a wallet operation started while another runs", async () => {
    const registry = boot();
    const run = Effect.runPromiseWith(
      await result(registry, linkshuRuntimeAtom),
    );
    let finish = () => {};
    const first = run(
      Effect.flatMap(WalletOpQueue, (queue) =>
        queue.runExclusive(
          Effect.promise(
            () =>
              new Promise<string>((resolve) => {
                finish = () => resolve("first");
              }),
          ),
        ),
      ),
    );
    const second = await run(
      Effect.flatMap(WalletOpQueue, (queue) =>
        queue.runExclusive(Effect.succeed("second")),
      ),
    );
    finish();

    expect(second).toEqual(Option.none());
    expect(await first).toEqual(Option.some("first"));
  });
});

describe("walletReadModelAtom", () => {
  it("re-reads the inventory when the wallet repository changes", async () => {
    const registry = boot();
    const unmount = registry.mount(walletReadModelAtom);
    const loaded = await result(registry, walletReadModelAtom);
    expect(loaded.proofs).toEqual([]);

    const wallet = await result(registry, walletRepositoryAtom);
    await Effect.runPromise(
      wallet.proofs.insert([proofAt("https://mint.example")]),
    );

    await vi.waitFor(() => {
      const model = Option.getOrThrow(
        AsyncResult.value(registry.get(walletReadModelAtom)),
      );
      expect(model.proofs).toHaveLength(1);
      expect(model.balances.total).toBe(8);
    });
    unmount();
  });
});

describe("linkshu commands", () => {
  it("fetches a previewed mint's info without making it a known mint", async () => {
    stubMintEndpoints();
    const registry = boot();
    const commands = await commandsOf(registry);

    const outcome = await commands.fetchMintInfo("https://preset.example");
    const known = await Effect.runPromiseWith(
      await result(registry, linkshuRuntimeAtom),
    )(Effect.flatMap(Mints, (mints) => mints.knownMints));

    expect(outcome).toEqual(
      Result.succeed(
        expect.objectContaining({
          url: "https://preset.example",
          inputFeePpk: 100,
          supportsMpp: true,
          iconUrl: "https://preset.example/icon.png",
        }),
      ),
    );
    expect(known).toEqual([]);
  });

  it("settles two concurrent receives, each with its own outcome", async () => {
    const registry = boot();
    const commands = await commandsOf(registry);
    const mints = gateMints();

    const first = commands.receiveCashuToken(
      buildCashuToken({ mint: "https://mint-a.test" }),
    );
    const second = commands.receiveCashuToken(
      buildCashuToken({ mint: "https://mint-b.test" }),
    );
    await vi.waitFor(() => expect(mints.fetch).toHaveBeenCalled());
    mints.release();

    expect(await Promise.all([first, second])).toEqual([
      Result.fail(
        expect.objectContaining({
          _tag: "ReceiveDeferred",
          mint: "https://mint-a.test",
        }),
      ),
      Result.fail(
        expect.objectContaining({
          _tag: "ReceiveDeferred",
          mint: "https://mint-b.test",
        }),
      ),
    ]);
  });

  it("signs receives of tokens locked to the session's npub with its nostr key", async () => {
    const identity = makeIdentity();
    const lockTo = (pubkey: Pubkey) =>
      parseP2pkPubkey(encodeNpub(pubkey)) ?? "";
    const registry = boot(
      signedInSession({
        appMnemonic: APP_MNEMONIC,
        nsec: encodeNsec(identity.secretKey),
      }),
    );
    const commands = await commandsOf(registry);
    gateMints().release();

    const own = await commands.receiveCashuToken(
      buildCashuToken({
        mint: "https://mint-a.test",
        lockedTo: lockTo(identity.pubkey),
      }),
    );
    const other = await commands.receiveCashuToken(
      buildCashuToken({
        mint: "https://mint-b.test",
        lockedTo: lockTo(makeIdentity().pubkey),
      }),
    );

    // Signable, so it reaches the offline mint instead of failing as locked.
    expect(own).toEqual(
      Result.fail(expect.objectContaining({ _tag: "ReceiveDeferred" })),
    );
    expect(other).toEqual(
      Result.fail(expect.objectContaining({ _tag: "TokenLocked" })),
    );
  });

  it("keeps a send running when the screen that started it unmounts", async () => {
    const registry = boot();
    const wallet = await result(registry, walletRepositoryAtom);
    await Effect.runPromise(
      wallet.proofs.insert([proofAt("https://mint-a.test")]),
    );
    type Wallet = ReturnType<typeof useLinkshuComposition>;
    const hook: { commands: Wallet | null } = { commands: null };
    const Probe = ({ onRender }: { onRender: (wallet: Wallet) => void }) => {
      onRender(useLinkshuComposition());
      return null;
    };
    const view = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <Probe
          onRender={(wallet) => {
            hook.commands = wallet;
          }}
        />
      </RegistryContext.Provider>,
    );
    await vi.waitFor(() =>
      expect(hook.commands?.sendCashuToken).not.toBeNull(),
    );
    const mints = gateMints();

    const sending = hook.commands?.sendCashuToken?.({
      amountSat: 1,
      mint: "https://mint-a.test",
      produceAs: "pending",
    });
    await vi.waitFor(() => expect(mints.fetch).toHaveBeenCalled());
    await view.unmount();
    mints.release();

    await expect(sending).resolves.toEqual(
      Result.fail(
        expect.objectContaining({
          _tag: "MintUnreachable",
          mint: "https://mint-a.test",
        }),
      ),
    );
  });

  it("does not re-run a finished command when the runtime rebuilds", async () => {
    const registry = boot();
    const unmount = registry.mount(linkshuCommandsAtom);
    const commands = await commandsOf(registry);
    const mints = gateMints();
    mints.release();
    await commands.receiveCashuToken(
      buildCashuToken({ mint: "https://mint-a.test" }),
    );
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
    const mintCalls = mints.fetch.mock.calls.length;

    registry.refresh(linkshuRuntimeAtom);
    expect(await commandsOf(registry)).not.toBe(commands);
    await settle();

    expect(mints.fetch).toHaveBeenCalledTimes(mintCalls);
    unmount();
  });
});
