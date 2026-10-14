import { UIProvider } from "@linky-fit/ui";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach } from "vitest";
import type { Device } from "../services/device";
import { DeviceProvider } from "../services/DeviceProvider";

const unmounts = new Set<() => Promise<void>>();

afterEach(async () => {
  for (const unmount of [...unmounts]) await unmount();
});

/** Renders `element` in the fazole theme under `device`; unmounted after each test. */
export const render = async (
  element: ReactElement,
  device: Device,
): Promise<HTMLDivElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const unmount = async () => {
    unmounts.delete(unmount);
    await act(async () => root.unmount());
    container.remove();
  };
  unmounts.add(unmount);
  await act(async () => {
    root.render(
      <UIProvider mode="dark" brand="fazole">
        <DeviceProvider device={device}>{element}</DeviceProvider>
      </UIProvider>,
    );
  });
  return container;
};

/** Sets an input's value the way typing, pasting or autofill does, so React sees the change. */
export const typeInto = async (
  input: HTMLInputElement,
  value: string,
): Promise<void> => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

export const byTestId = <E extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
): E => {
  const element = container.querySelector<E>(`[data-testid="${testId}"]`);
  if (element === null) throw new Error(`no ${testId}`);
  return element;
};
