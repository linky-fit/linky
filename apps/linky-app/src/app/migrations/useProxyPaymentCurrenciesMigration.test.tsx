import { makeSettingsRepository } from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { expect, it } from "vitest";
import { makeTestLinkyStore } from "../../testUtils/linkyStore";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { useProxyPaymentCurrenciesMigration } from "./useProxyPaymentCurrenciesMigration";

const migrate = async (
  setting: ReadonlyArray<string> | null,
  status: string | null,
) => {
  const { store } = makeTestLinkyStore();
  const settings = makeSettingsRepository(store);
  const Probe = () => {
    useProxyPaymentCurrenciesMigration({
      setting,
      status,
      settingsRepository: settings,
      hydrated: true,
    });
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  await act(async () => {});
  await view.unmount();
  return Effect.runPromise(settings.get("proxyPaymentCurrencies"));
};

it("carries the status's currencies into the unset setting", async () => {
  expect(await migrate(null, "Paying for lunch\nCZK, EUR")).toEqual([
    "CZK",
    "EUR",
  ]);
});

it("leaves a set setting, an empty one included, and a status without currencies alone", async () => {
  expect(await migrate([], "CZK")).toBeNull();
  expect(await migrate(null, "Just text")).toBeNull();
});
