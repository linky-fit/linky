import { UIProvider } from "@linky-fit/ui";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mountedRoots } from "./mountedRoots";

export interface RenderedElement {
  container: HTMLDivElement;
  root: Root;
  rerender: (element: ReactElement) => Promise<void>;
  unmount: () => Promise<void>;
}

export const renderIntoDocument = async (
  element: ReactElement,
): Promise<RenderedElement> => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = async (next: ReactElement): Promise<void> => {
    await act(async () => {
      root.render(<UIProvider mode="dark">{next}</UIProvider>);
    });
  };
  const unmount = async (): Promise<void> => {
    mountedRoots.delete(unmount);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };
  mountedRoots.add(unmount);
  await rerender(element);
  return { container, root, rerender, unmount };
};
