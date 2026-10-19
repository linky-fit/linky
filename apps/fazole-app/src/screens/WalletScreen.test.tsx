import {
  FiatRates,
  KeyValueStore,
  makeInMemoryKeyValueStore,
} from "@linky-fit/linkshu";
import { parsePubkey } from "@linky-fit/linkstr";
import { Layer, Schema } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../copy";
import { CzkAmount } from "../domain";
import { createAppServices, type AppServices } from "../services/appServices";
import type { Device } from "../services/device";
import {
  sharedOutboxStore,
  testAccount,
  testConfig,
  testStore,
} from "../services/testing/fakes";
import { fakeDevice } from "../testing/fakeDevice";
import { byTestId, render, typeInto } from "../testing/render";
import { WalletScreen } from "./WalletScreen";

const hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const pledger = parsePubkey(hex);
if (pledger === null) throw new Error("test pubkey");

const shop = { name: "Kavárna U Lípy", iban: null, picture: null };

// 2 500 000 Kč per BTC: a sat is 2,5 haléře.
const rates = Schema.decodeUnknownSync(FiatRates)({
  brlPerBtc: 1,
  chfPerBtc: 1,
  czkPerBtc: 2_500_000,
  eurPerBtc: 1,
  usdPerBtc: 1,
  fetchedAtMs: Date.now(),
});

const running: AppServices[] = [];

/** A signed-in device over in-memory stores, with a fixed rate and nothing on the network. */
const signedInDevice = (): { device: Device; services: AppServices } => {
  const services = createAppServices({
    account: testAccount(),
    store: testStore(),
    config: testConfig,
    ports: {
      outboxStore: sharedOutboxStore(),
      keyValueStore: Layer.succeed(KeyValueStore, makeInMemoryKeyValueStore()),
      fetchRates: async () => rates,
    },
  });
  running.push(services);
  const session = { _tag: "SignedIn", services, restored: false } as const;
  return { device: { ...fakeDevice(), session: () => session }, services };
};

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const services of running.splice(0)) await services.dispose();
});

const click = (container: HTMLElement, testId: string) =>
  act(async () => byTestId<HTMLButtonElement>(container, testId).click());

describe("the wallet with a pledge", () => {
  it("takes the debt off the balance and shows how the pledge stands", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { device, services } = signedInDevice();
    await services.pledges.open(
      { pubkey: pledger, address: "hynek@linky.fit" },
      CzkAmount.make(10_000),
    );
    const container = await render(<WalletScreen shop={shop} />, device);
    await expect
      .poll(() => byTestId(container, "wallet-balance").textContent)
      .toContain("-100");
    expect(byTestId(container, "wallet-cash").textContent).toBe(
      copy.wallet.pledgeButton("hynek@linky.fit", "100"),
    );
    await click(container, "wallet-cash");
    // The sheet renders in a portal, outside the screen's container.
    const status = byTestId(document.body, "pledge-status");
    expect(status.textContent).toContain("hynek@linky.fit");
    expect(status.textContent).toContain(copy.pledge.remaining);
  });

  it("offers a pledge from a Linky name when the wallet cannot cover the amount", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        fetched.push(String(url));
        return new Response(JSON.stringify({ names: { hynek: hex } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { device, services } = signedInDevice();
    const container = await render(<WalletScreen shop={shop} />, device);
    await click(container, "wallet-cash");
    const sheet = document.body;
    expect(byTestId<HTMLInputElement>(sheet, "cash-contact").value).toBe(
      "hynek@linky.fit",
    );
    await typeInto(byTestId(sheet, "cash-contact"), "hynek");
    await expect
      .poll(
        () => sheet.querySelector('[data-testid="cash-contact-resolved"]'),
        {
          timeout: 3_000,
        },
      )
      .not.toBeNull();
    expect(fetched.at(-1)).toBe(
      "https://linky.fit/.well-known/nostr.json?name=hynek",
    );
    await typeInto(byTestId(sheet, "cash-amount"), "100");
    await click(sheet, "cash-continue");
    await expect
      .poll(() => sheet.querySelector('[data-testid="cash-offer"]'))
      .not.toBeNull();
    expect(byTestId(sheet, "cash-offer").textContent).toContain(
      copy.cash.offerTitle(copy.czkAmount("100"), "hynek@linky.fit"),
    );
    await click(sheet, "cash-create-pledge");
    await expect
      .poll(() => sheet.querySelector('[data-testid="pledge-done"]'))
      .not.toBeNull();
    expect(byTestId(sheet, "pledge-done").textContent).toContain(
      copy.pledge.openedTitle(copy.czkAmount("100"), "hynek@linky.fit"),
    );
    expect(await services.pledges.current()).toMatchObject({
      pubkey: pledger,
      address: "hynek@linky.fit",
      amountCzk: 10_000,
    });
  });
});
