import { appOwnerFromMnemonic } from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import { memoryKvPorts } from "../testUtils/appRegistry";
import { adoptSecretsFromPreviousInstall } from "./nativeInstall";
import type { SecretRead } from "./ports";

const APP_MNEMONIC =
  "diet swift world sand heart donate squeeze never inner glove ability exist";
const awaitingKey = `linky.shards.awaitingFirstHydration.${appOwnerFromMnemonic(APP_MNEMONIC)?.id}`;

const boot = async (read: SecretRead, initial: Record<string, string> = {}) => {
  const { items, ports } = memoryKvPorts(initial);
  await adoptSecretsFromPreviousInstall({
    ...ports,
    secrets: { read: () => Promise.resolve(read) },
  });
  return items;
};

describe("adoptSecretsFromPreviousInstall", () => {
  it("waits for the first hydration of an account a previous install left in the keychain", async () => {
    const items = await boot({ _tag: "Found", value: APP_MNEMONIC });
    expect(items.get(awaitingKey)).toBe("1");
    expect(items.get("linky.native.installed")).toBe("1");
  });

  it("only marks the install on a fresh device", async () => {
    const items = await boot({ _tag: "Missing" });
    expect(Array.from(items.keys())).toEqual(["linky.native.installed"]);
  });

  it("leaves an install it has seen alone", async () => {
    const items = await boot(
      { _tag: "Found", value: APP_MNEMONIC },
      { "linky.native.installed": "1" },
    );
    expect(items.has(awaitingKey)).toBe(false);
  });

  it("asks again on the next boot when the store cannot answer", async () => {
    const items = await boot({ _tag: "Unavailable", cause: "locked" });
    expect(items.size).toBe(0);
  });
});
