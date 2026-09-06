import React from "react";

/**
 * Settled swipe progress lives outside the app shell so changing tabs only
 * updates the indicator and FAB. Native scroll frames do not publish here.
 */
interface MainSwipeProgressState {
  progress: number;
}

let state: MainSwipeProgressState = { progress: 0 };
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const mainSwipeProgressStore = {
  get: (): MainSwipeProgressState => state,
  set: (nextState: MainSwipeProgressState): void => {
    if (state.progress === nextState.progress) return;
    state = nextState;
    emit();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export const useMainSwipeProgress = (): MainSwipeProgressState =>
  React.useSyncExternalStore(
    mainSwipeProgressStore.subscribe,
    mainSwipeProgressStore.get,
    mainSwipeProgressStore.get,
  );
