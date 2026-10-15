import { useCallback, type RefObject } from "react";

/** Points a DOM ref at a Tamagui view, which hands its ref the DOM node on the web. */
export const useDivRef = (ref: RefObject<HTMLDivElement | null>) =>
  useCallback(
    (node: unknown) => {
      ref.current = node instanceof HTMLDivElement ? node : null;
    },
    [ref],
  );
