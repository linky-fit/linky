import { NewProof } from "@linky-fit/linkshu";
import { RegistryContext } from "@linky-fit/linkstr-react";
import { Effect, Schema } from "effect";
import { AtomRegistry } from "effect/reactivity";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaymentsCommands } from "../../hooks/wallet/paymentUi";
import {
  makeTestAppRegistry,
  signedInSession,
} from "../../../testUtils/appRegistry";
import { makeLightningInvoice } from "../../../testUtils/lightningInvoice";
import { makeTestLinkyStore } from "../../../testUtils/linkyStore";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { linkshuRuntimeAtom } from "../linkshu/runtime";
import { walletRepositoryAtom } from "../session/store";
import { paymentsCommandsAtom, type PaymentsCommands } from "./payments";

vi.mock("@evolu/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@evolu/common")>()),
  createEvolu: () => () => ({}),
}));
const openLinkyStore = vi.hoisted(() => vi.fn());
vi.mock("@linky-fit/linksync/evolu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@linky-fit/linksync/evolu")>()),
  openLinkyStore,
}));
vi.mock("../../migrations/linkshuStorageMigration", () => ({
  migrateLegacyCashuLocalState: () => {},
}));
vi.mock("../../../platform/identitySecrets", () => ({
  readStoredCashuMnemonic: () => Promise.resolve(null),
  writeStoredCashuMnemonic: () => Promise.resolve(),
}));

const APP_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const MINT = "https://mint-a.test";

const result = <A, E>(
  registry: AtomRegistry.AtomRegistry,
  atom: Parameters<typeof AtomRegistry.getResult<A, E>>[1],
) => Effect.runPromise(AtomRegistry.getResult(registry, atom));

/** A wallet holding 128 sat at one mint, the session signed in. */
const boot = async () => {
  openLinkyStore.mockResolvedValue(makeTestLinkyStore().store);
  const registry = makeTestAppRegistry({
    session: signedInSession({ appMnemonic: APP_MNEMONIC }),
  });
  const wallet = await result(registry, walletRepositoryAtom);
  await Effect.runPromise(
    wallet.proofs.insert([
      Schema.decodeUnknownSync(NewProof)({
        mint: MINT,
        unit: "sat",
        keysetId: "00ab",
        amount: 128,
        secret: "secret-128",
        C: "02ab",
        dleq: null,
        state: "available",
        operationId: null,
      }),
    ]),
  );
  return registry;
};

/** Mint calls hang until `release`, then fail as if the mint were offline. */
const gateMints = () => {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(() =>
    opened.then(() => Promise.reject(new TypeError("Failed to fetch"))),
  );
  vi.stubGlobal("fetch", fetch);
  const mintCalls = () =>
    fetch.mock.calls.filter(([input]) => String(input).startsWith(MINT)).length;
  return { fetch, mintCalls, release };
};

const invoice = makeLightningInvoice("1u");

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("__APP_VERSION__", "test");
});
afterEach(() => vi.unstubAllGlobals());

describe("wallet payment commands", () => {
  it("keeps a payment running when the screen that started it unmounts", async () => {
    const registry = await boot();
    const hook: { commands: PaymentsCommands | null } = { commands: null };
    const Probe = () => {
      const commands = usePaymentsCommands();
      useEffect(() => {
        hook.commands = commands;
      }, [commands]);
      return null;
    };
    const view = await renderIntoDocument(
      <RegistryContext.Provider value={registry}>
        <Probe />
      </RegistryContext.Provider>,
    );
    await vi.waitFor(() => expect(hook.commands).not.toBeNull());
    const mints = gateMints();

    const paying = hook.commands?.payLightningInvoice(invoice);
    await vi.waitFor(() => expect(mints.fetch).toHaveBeenCalled());
    await view.unmount();
    mints.release();

    await expect(paying).resolves.toEqual({ _tag: "NetworkError" });
  });

  it("does not re-run a finished payment when the linkshu runtime rebuilds", async () => {
    const registry = await boot();
    const unmount = registry.mount(paymentsCommandsAtom);
    const commands = await result(registry, paymentsCommandsAtom);
    const mints = gateMints();
    mints.release();
    await commands.payLightningInvoice(invoice);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
    const mintCalls = mints.mintCalls();

    registry.refresh(linkshuRuntimeAtom);
    expect(await result(registry, paymentsCommandsAtom)).not.toBe(commands);
    await settle();

    expect(mints.mintCalls()).toBe(mintCalls);
    unmount();
  });
});
