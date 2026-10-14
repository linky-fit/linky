import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { InvalidRecoverySeed, createRecoverySeed } from "../storage/account";
import { fakeDevice } from "../testing/fakeDevice";
import { byTestId, render, typeInto } from "../testing/render";
import { RestoreScreen } from "./RestoreScreen";

const seed = await Effect.runPromise(createRecoverySeed);

describe("the restore screen", () => {
  it("is a password field a password manager can fill", async () => {
    const container = await render(<RestoreScreen />, fakeDevice());
    const field = byTestId<HTMLInputElement>(container, "restore-seed");
    expect(field.type).toBe("password");
    expect(field.autocomplete).toBe("current-password");
  });

  it("restores at once when a whole seed is pasted", async () => {
    const device = fakeDevice();
    const container = await render(<RestoreScreen />, device);
    await typeInto(byTestId(container, "restore-seed"), seed);
    expect(device.restoreAccount).toHaveBeenCalledWith(seed);
  });

  it("waits for the submit while the seed is typed word by word", async () => {
    const device = fakeDevice();
    const container = await render(<RestoreScreen />, device);
    const field = byTestId<HTMLInputElement>(container, "restore-seed");
    for (let length = 1; length <= seed.length; length += 1) {
      await typeInto(field, seed.slice(0, length));
    }
    expect(device.restoreAccount).not.toHaveBeenCalled();
  });

  it("says when the seed is not valid", async () => {
    const device = fakeDevice();
    device.restoreAccount.mockResolvedValue(
      Result.fail(new InvalidRecoverySeed()),
    );
    const container = await render(<RestoreScreen />, device);
    await typeInto(byTestId(container, "restore-seed"), seed);
    expect(container.textContent).toContain(copy.restore.invalid);
  });
});
