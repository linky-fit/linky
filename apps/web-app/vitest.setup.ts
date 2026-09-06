import { Buffer } from "buffer";

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
