import {
  createId,
  makeDevicesRepository,
  type DeviceApp,
} from "@linky-fit/linksync";
import { Effect } from "effect";
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readThisDevice } from "../app/lib/thisDevice";
import { makeTestLinkyStore } from "../testUtils/linkyStore";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { DevicesPage } from "./DevicesPage";

const { testStore } = vi.hoisted(() => {
  const holder: { current: ReturnType<typeof makeTestLinkyStore> | null } = {
    current: null,
  };
  return { testStore: holder };
});

const devices = () => {
  if (testStore.current === null) throw new Error("no test store");
  return makeDevicesRepository(testStore.current.store);
};

vi.mock("../app/hooks/useLinksync", async () => {
  const { useRepositoryRows } = await import("@linky-fit/linksync/react");
  const { makeDevicesRepository: make } = await import("@linky-fit/linksync");
  const { useMemo } = await import("react");
  const useDevicesRepository = () =>
    useMemo(() => {
      if (testStore.current === null) throw new Error("no test store");
      return make(testStore.current.store);
    }, []);
  return {
    useDevicesRepository,
    useDeviceRecords: () => useRepositoryRows(useDevicesRepository()),
  };
});
vi.mock("../app/hooks/shell", async () =>
  (await import("../testUtils/shellHooks")).shellHooksMock(),
);
vi.mock("../app/hooks/settings/useIdentitySettings", () => ({
  useSeedMnemonic: () => "academic acid acne",
}));
vi.mock("../app/hooks/profile/useEffectiveProfile", () => ({
  useEffectiveProfile: () => ({ effectiveProfileName: "Hynek" }),
}));

const add = (app: DeviceApp, name: string, id = createId<"Device">()) => {
  Effect.runSync(
    devices().register({
      id,
      app,
      name: name,
      deviceType: "mobile",
      browserName: null,
      osName: "Android",
      joining: true,
    }),
  );
  return id;
};

const button = (label: string) => {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

beforeEach(() => {
  testStore.current = makeTestLinkyStore();
});

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

it("lists every app's devices, this one first and marked", async () => {
  add("finito", "Terminal");
  add("linky", "Phone", readThisDevice().id);
  const { container, unmount } = await renderIntoDocument(<DevicesPage />);

  const rows = [...container.querySelectorAll('[data-testid^="device-"]')];
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("Phone"),
    expect.stringContaining("Terminal"),
  ]);
  expect(rows[0]?.textContent).toContain("devicesThisDevice");
  expect(rows[1]?.textContent).toContain("Finito · Android");
  await unmount();
});

it("removes another device only after the user confirms", async () => {
  const other = add("fazole", "Shop tablet");
  add("linky", "Phone", readThisDevice().id);
  const { container, unmount } = await renderIntoDocument(<DevicesPage />);

  const row = container.querySelector<HTMLElement>(
    `[data-testid="device-${other}"]`,
  );
  await act(async () => row?.click());
  await act(async () => button("devicesRemove").click());
  expect(Effect.runSync(devices().removal(other))).toBeNull();

  await act(async () => button("devicesRemove").click());

  expect(Effect.runSync(devices().removal(other))).toMatchObject({
    by: { name: "Phone", app: "linky" },
  });
  await unmount();
});

it("renames this device but offers no removal of it", async () => {
  const id = add("linky", "Phone", readThisDevice().id);
  const { container, unmount } = await renderIntoDocument(<DevicesPage />);

  await act(async () =>
    container
      .querySelector<HTMLElement>(`[data-testid="device-${id}"]`)
      ?.click(),
  );
  expect(
    [...document.querySelectorAll("button")].some(
      (element) => element.textContent === "devicesRemove",
    ),
  ).toBe(false);
  const field = document.querySelector<HTMLInputElement>(
    '[data-testid="device-name"]',
  );
  if (!field) throw new Error("no name field");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setValue?.call(field, "Work phone");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("devicesRename").click());

  expect(Effect.runSync(devices().all)).toMatchObject([{ name: "Work phone" }]);
  await unmount();
});
