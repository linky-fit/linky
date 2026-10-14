import { Result } from "effect";
import { vi } from "vitest";
import type { Device } from "../services/device";

const signedOut = { _tag: "SignedOut" } as const;

/** A signed-out device whose account calls only record what they were asked. */
export const fakeDevice = () =>
  ({
    session: () => signedOut,
    subscribe: () => () => {},
    prepareAccount: vi.fn<Device["prepareAccount"]>(),
    createAccount: vi.fn<Device["createAccount"]>(async () => {}),
    restoreAccount: vi.fn<Device["restoreAccount"]>(async () => Result.void),
    resetDevice: vi.fn<Device["resetDevice"]>(),
  }) satisfies Device;
