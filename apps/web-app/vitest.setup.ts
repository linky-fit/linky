import { Buffer } from "buffer";
import { afterEach } from "vitest";
import { unmountMountedRoots } from "./src/testUtils/mountedRoots";

if (typeof globalThis.Buffer === "undefined") {
  Object.defineProperty(globalThis, "Buffer", {
    configurable: true,
    value: Buffer,
    writable: true,
  });
}

// Provide a minimal Worker polyfill for jsdom so Evolu can initialize.
if (typeof globalThis.Worker === "undefined") {
  class MockWorker {
    onmessage: ((this: Worker, ev: MessageEvent) => unknown) | null = null;
    onmessageerror: ((this: Worker, ev: MessageEvent) => unknown) | null = null;

    constructor() {}

    postMessage(): void {}

    terminate(): void {}

    addEventListener(): void {}

    removeEventListener(): void {}
    dispatchEvent(): boolean {
      return false;
    }
  }

  // @ts-expect-error assign polyfill
  globalThis.Worker = MockWorker;
}

// React's act() only works when the test environment opts in.
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
  writable: true,
});

// jsdom has no matchMedia, and Tamagui reads it at module load.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// A root left mounted keeps scheduling React work after jsdom is torn down,
// which fails the run with "window is not defined".
afterEach(unmountMountedRoots);
