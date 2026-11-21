import { AtomRegistry, RegistryContext } from "@linky-fit/linkstr-react";
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlatformPorts } from "../../../testUtils/appRegistry";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { platformAtom } from "../../state/platform";
import {
  evoluServersAtom,
  evoluStorageCommandsAtom,
} from "../../state/session/evoluSettings";
import { useClearEvoluDatabase } from "./useEvoluSettings";

const pushToast = vi.hoisted(() => vi.fn<(message: string) => void>());
vi.mock("../shell", async () =>
  (await import("../../../testUtils/shellHooks")).shellHooksMock({
    pushToast: (message) => pushToast(message),
  }),
);

const SERVER = "https://evolu.example";

const mountClear = async (disabledUrls: readonly string[] = []) => {
  const wipeEvoluStorage = vi.fn(async () => {});
  const registry = AtomRegistry.make({
    initialValues: [
      [platformAtom, testPlatformPorts()],
      [
        evoluServersAtom,
        {
          configuredUrls: [SERVER],
          disabledUrls,
          statusByUrl: {},
          reloadRequired: false,
        },
      ],
      [evoluStorageCommandsAtom, { read: () => ({ wipeEvoluStorage }) }],
    ],
  });
  const result: { current: ReturnType<typeof useClearEvoluDatabase> | null } = {
    current: null,
  };
  const Harness = () => {
    const clear = useClearEvoluDatabase();
    React.useEffect(() => {
      result.current = clear;
    });
    return null;
  };
  const read = () => {
    if (result.current === null) throw new Error("hook not mounted");
    return result.current;
  };
  const view = await renderIntoDocument(
    <RegistryContext.Provider value={registry}>
      <Harness />
    </RegistryContext.Provider>,
  );
  return { read, unmount: view.unmount, wipeEvoluStorage };
};

describe("useClearEvoluDatabase", () => {
  afterEach(() => {
    vi.useRealTimers();
    pushToast.mockClear();
  });

  it("arms, confirms, and times out database clearing", async () => {
    vi.useFakeTimers();
    const { read, unmount, wipeEvoluStorage } = await mountClear();

    act(() => read().requestClearDatabase());
    expect(read().clearDatabaseArmed).toBe(true);
    expect(pushToast).toHaveBeenCalledWith("deleteArmedHint");
    expect(wipeEvoluStorage).not.toHaveBeenCalled();

    act(() => read().requestClearDatabase());
    expect(read().clearDatabaseArmed).toBe(false);
    expect(wipeEvoluStorage).toHaveBeenCalledTimes(1);

    act(() => read().requestClearDatabase());
    expect(read().clearDatabaseArmed).toBe(true);

    act(() => vi.advanceTimersByTime(5000));
    expect(read().clearDatabaseArmed).toBe(false);

    await unmount();
  });

  it("warns on arming that no active server backs the data up", async () => {
    const { read, unmount } = await mountClear([SERVER]);

    act(() => read().requestClearDatabase());
    expect(pushToast).toHaveBeenCalledWith(
      "evoluNoBackupWarning deleteArmedHint",
    );

    await unmount();
  });
});
