import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

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
      root.render(next);
    });
  };
  await rerender(element);
  return {
    container,
    root,
    rerender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};
