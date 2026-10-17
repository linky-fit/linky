import type { Route } from "../../types/route";
import type { GuideHighlightRect } from "../state/shell/guide";

/** A rendered element: a DOM element on the web, a host view on native. */
export type GuideTargetNode = object;

type GuideTargetRef = (node: GuideTargetNode | null) => () => void;

const nodesById = new Map<string, Set<GuideTargetNode>>();
const refsById = new Map<string, GuideTargetRef>();

/** The ref that marks an element the guided tour can highlight, for elements the web finds by their `testID`. */
export const guideTargetRef = (id: string): GuideTargetRef => {
  const existing = refsById.get(id);
  if (existing) return existing;
  const ref: GuideTargetRef = (node) => {
    if (node === null) return () => {};
    const nodes = nodesById.get(id) ?? new Set();
    nodes.add(node);
    nodesById.set(id, nodes);
    return () => {
      nodes.delete(node);
    };
  };
  refsById.set(id, ref);
  return ref;
};

/**
 * Marks an element the guided tour can highlight: the web finds it by its
 * `data-guide` attribute, native by the ref, as React Native drops `data-*`.
 */
export const guideTarget = (id: string) => ({
  "data-guide": id,
  ref: guideTargetRef(id),
});

const isDetached = (node: GuideTargetNode): boolean =>
  "isConnected" in node && node.isConnected === false;

/** The mounted elements marked `id`, oldest first. */
export const guideTargetNodes = (id: string): readonly GuideTargetNode[] => {
  const nodes = nodesById.get(id);
  if (!nodes) return [];
  // Composed refs (Tamagui's) drop the cleanup a ref returns, so detached elements are pruned here.
  for (const node of nodes) if (isDetached(node)) nodes.delete(node);
  return [...nodes];
};

export interface UseGuideHighlightParams {
  /** The `guideTarget` id or test id of the element to highlight, or null for none. */
  target: string | null;
  /** Scrolls the target into view again whenever the step changes. */
  stepId: string | null;
  routeKind: Route["kind"];
  onRect: (rect: GuideHighlightRect | null) => void;
}
