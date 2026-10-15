import { act } from "react";
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { fakeDevice } from "../testing/fakeDevice";
import { byTestId, render, typeInto } from "../testing/render";
import { SetupScreen } from "./SetupScreen";

const submit = (container: HTMLElement) =>
  act(async () =>
    byTestId<HTMLButtonElement>(container, "setup-submit").click(),
  );

describe("the setup screen", () => {
  it("prepares the recovery seed as soon as it opens", async () => {
    const device = fakeDevice();
    await render(<SetupScreen />, device);
    expect(device.prepareAccount).toHaveBeenCalled();
  });

  it("explains a wrong account and creates nothing", async () => {
    const device = fakeDevice();
    const container = await render(<SetupScreen />, device);
    await typeInto(byTestId(container, "shop-name"), "Kavárna U Lípy");
    await typeInto(byTestId(container, "shop-account"), "2000145398/0800");
    expect(container.textContent).toContain(
      copy.shopFields.accountInvalidChecksum,
    );
    await submit(container);
    expect(device.createAccount).not.toHaveBeenCalled();
  });

  it("creates a nameless account without a bank account, to be set up later", async () => {
    const device = fakeDevice();
    const container = await render(<SetupScreen />, device);
    const button = byTestId(container, "setup-submit");
    expect(button.textContent).toBe(copy.setup.later);
    await typeInto(byTestId(container, "shop-name"), "K");
    expect(button.textContent).toBe(copy.setup.submit);
    await typeInto(byTestId(container, "shop-name"), "  ");
    await submit(container);
    expect(device.createAccount).toHaveBeenCalledWith({
      name: null,
      iban: null,
      picture: null,
    });
  });

  it("creates the account with the shop and its IBAN, or without a bank account", async () => {
    const device = fakeDevice();
    const container = await render(<SetupScreen />, device);
    await typeInto(byTestId(container, "shop-name"), " Kavárna U Lípy ");
    await typeInto(byTestId(container, "shop-account"), "19-2000145399/0800");
    expect(container.textContent).toContain("CZ65 0800 0000 1920 0014 5399");
    await submit(container);
    expect(device.createAccount).toHaveBeenCalledWith({
      name: "Kavárna U Lípy",
      iban: "CZ6508000000192000145399",
      picture: null,
    });

    const bitcoinOnly = fakeDevice();
    const other = await render(<SetupScreen />, bitcoinOnly);
    await typeInto(byTestId(other, "shop-name"), "Stánek");
    await submit(other);
    expect(bitcoinOnly.createAccount).toHaveBeenCalledWith({
      name: "Stánek",
      iban: null,
      picture: null,
    });
  });
});
