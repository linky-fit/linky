import { KeyValueStore, makeInMemoryKeyValueStore } from "@linky-fit/linkshu";
import { Effect, Layer, Result } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copy } from "../copy";
import { czechAccountToIban, parseCzechAccount } from "../domain";
import { createAppServices, type AppServices } from "../services/appServices";
import type { Device } from "../services/device";
import {
  sharedOutboxStore,
  testAccount,
  testConfig,
  testStore,
} from "../services/testing/fakes";
import { readMintUrl } from "../storage/mintSetting";
import { readMonetaConnection } from "../storage/monetaSetting";
import { fakeDevice } from "../testing/fakeDevice";
import { byTestId, render, typeInto } from "../testing/render";
import { SettingsScreen } from "./SettingsScreen";

// The build defines the version globals the footer reads when the screen module loads.
vi.hoisted(() => {
  vi.stubGlobal("__APP_VERSION__", "26.10.3");
  vi.stubGlobal("__APP_COMMIT_SHA__", "");
});

const ibanOf = (account: string) => {
  const parsed = parseCzechAccount(account);
  if (Result.isFailure(parsed)) throw new Error(`invalid ${account}`);
  return czechAccountToIban(parsed.success);
};
const monetaIban = ibanOf("2000145399/0600");
const shop = { name: "Kavárna U Lípy", iban: null, picture: null };
const monetaShop = { ...shop, iban: monetaIban };
const token = "token-".padEnd(40, "x");
const running: AppServices[] = [];

/** A signed-in device over in-memory stores whose config names the recommended production mint and whose bank relay answers every call with `bank`. */
const signedInDevice = (
  bank: (url: string, authorization: string) => Response = () =>
    new Response(
      JSON.stringify({
        accounts: [{ id: "acc-1", identification: { iban: monetaIban } }],
      }),
      { status: 200 },
    ),
): { device: Device; services: AppServices } => {
  const services = createAppServices({
    account: testAccount(),
    store: testStore(),
    config: { ...testConfig, mintUrl: "https://cashu.cz" },
    ports: {
      outboxStore: sharedOutboxStore(),
      keyValueStore: Layer.succeed(KeyValueStore, makeInMemoryKeyValueStore()),
      fetch: async (input, init) =>
        bank(
          String(input),
          new Headers(init?.headers).get("authorization") ?? "",
        ),
    },
  });
  running.push(services);
  const session = { _tag: "SignedIn", services, restored: false } as const;
  return { device: { ...fakeDevice(), session: () => session }, services };
};

afterEach(async () => {
  for (const services of running.splice(0)) await services.dispose();
});

const click = (container: ParentNode, testId: string) =>
  act(async () => byTestId<HTMLButtonElement>(container, testId).click());

const storedConnection = (services: AppServices) =>
  Effect.runPromise(readMonetaConnection(services.repositories.settings));

describe("the MONETA connection", () => {
  it("is offered for a MONETA account only", async () => {
    const { device } = signedInDevice();
    const container = await render(
      <SettingsScreen shop={monetaShop} />,
      device,
    );
    await expect
      .poll(() => byTestId(container, "settings-moneta").textContent)
      .toContain(copy.settings.monetaOff);
    const other = await render(
      <SettingsScreen
        shop={{ ...monetaShop, iban: ibanOf("2000145399/0800") }}
      />,
      device,
    );
    expect(other.querySelector('[data-testid="settings-moneta"]')).toBeNull();
  });

  it("connects a token the bank accepts for the shop's account", async () => {
    const seen: string[] = [];
    const { device, services } = signedInDevice((url, authorization) => {
      seen.push(`${authorization} ${url}`);
      return new Response(
        JSON.stringify({
          accounts: [{ id: "acc-1", identification: { iban: monetaIban } }],
        }),
      );
    });
    // The connection reads the shop's account from the store, not from the screen's props.
    await services.shop.save(monetaShop);
    const container = await render(
      <SettingsScreen shop={monetaShop} />,
      device,
    );
    await click(container, "settings-moneta");
    // The dialog renders in a portal, outside the screen's container.
    const dialog = byTestId(document.body, "moneta-dialog");
    await typeInto(byTestId(dialog, "moneta-token"), ` ${token} `);
    await click(dialog, "moneta-connect");
    await expect
      .poll(() => storedConnection(services))
      .toEqual({ token, accountId: "acc-1", iban: monetaIban });
    expect(seen).toEqual([`Bearer ${token} /api/moneta/accounts`]);
    await expect
      .poll(() => byTestId(container, "settings-moneta").textContent)
      .toContain(copy.settings.monetaOn);
    expect(document.body.querySelector('[data-testid="moneta-dialog"]')).toBe(
      null,
    );
    await click(container, "settings-moneta");
    expect(byTestId(document.body, "moneta-connected").textContent).toContain(
      "2000145399/0600",
    );
    await click(document.body, "moneta-disconnect");
    await expect.poll(() => storedConnection(services)).toBeNull();
  });

  it("says why a token was refused and stores nothing", async () => {
    const { device, services } = signedInDevice(
      () => new Response("", { status: 401 }),
    );
    // The connection reads the shop's account from the store, not from the screen's props.
    await services.shop.save(monetaShop);
    const container = await render(
      <SettingsScreen shop={monetaShop} />,
      device,
    );
    await click(container, "settings-moneta");
    const dialog = byTestId(document.body, "moneta-dialog");
    await typeInto(byTestId(dialog, "moneta-token"), token);
    await click(dialog, "moneta-connect");
    await expect
      .poll(() => dialog.textContent)
      .toContain(copy.settings.monetaFailures.unauthorized);
    expect(await storedConnection(services)).toBeNull();
  });

  it("offers the token right after a MONETA account is saved", async () => {
    const { device } = signedInDevice();
    const container = await render(
      <SettingsScreen shop={{ ...monetaShop, iban: null }} />,
      device,
    );
    expect(
      container.querySelector('[data-testid="settings-moneta"]'),
    ).toBeNull();
    await click(container, "settings-shop");
    const shopDialog = byTestId(document.body, "shop-dialog");
    await typeInto(byTestId(shopDialog, "shop-account"), "2000145399/0600");
    await click(shopDialog, "shop-save");
    await expect
      .poll(() => document.body.querySelector('[data-testid="moneta-dialog"]'))
      .not.toBeNull();
  });
});

const storedMint = (services: AppServices) =>
  Effect.runPromise(
    readMintUrl(services.repositories.settings, services.config.mintUrl),
  );

describe("the mint setting", () => {
  it("shows the mint's host and lists the recommended mints with the current one selected", async () => {
    const { device } = signedInDevice();
    const container = await render(<SettingsScreen shop={shop} />, device);
    await expect
      .poll(() => byTestId(container, "settings-mint").textContent)
      .toContain("cashu.cz");
    await click(container, "settings-mint");
    // The dialog renders in a portal, outside the screen's container.
    const dialog = byTestId(document.body, "mint-dialog");
    expect(dialog.textContent).toContain("mint.minibits.cash");
    expect(
      byTestId(dialog, "mint-row-cashu.cz").getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      byTestId(dialog, "mint-row-kashu.me").getAttribute("aria-selected"),
    ).not.toBe("true");
  });

  it("saves the picked mint and closes", async () => {
    const { device, services } = signedInDevice();
    const container = await render(<SettingsScreen shop={shop} />, device);
    await click(container, "settings-mint");
    await click(document.body, "mint-row-kashu.me");
    await expect.poll(() => storedMint(services)).toBe("https://kashu.me");
    expect(document.body.querySelector('[data-testid="mint-dialog"]')).toBe(
      null,
    );
    await expect
      .poll(() => byTestId(container, "settings-mint").textContent)
      .toContain("kashu.me");
  });

  it("adds a mint by its address, and refuses what is not one", async () => {
    const { device, services } = signedInDevice();
    const container = await render(<SettingsScreen shop={shop} />, device);
    await click(container, "settings-mint");
    const dialog = byTestId(document.body, "mint-dialog");
    await typeInto(byTestId(dialog, "mint-url"), "not a mint");
    await click(dialog, "mint-add");
    expect(dialog.textContent).toContain(copy.settings.mintUrlInvalid);
    expect(await storedMint(services)).toBe("https://cashu.cz");

    await typeInto(byTestId(dialog, "mint-url"), "mint.example.org");
    await click(dialog, "mint-add");
    await expect
      .poll(() => storedMint(services))
      .toBe("https://mint.example.org");
  });
});
