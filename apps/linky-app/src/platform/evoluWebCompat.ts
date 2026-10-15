import type {
  BroadcastChannelLike,
  BroadcastMessageHandler,
  LockManagerLike,
} from "../types/browser";
import type { JsonValue } from "../types/json";

export const applyEvoluWebCompatPolyfills = () => {
  // Some iOS/WebKit environments (notably private browsing) may lack
  // `navigator.locks` and/or `BroadcastChannel`, which Evolu's shared worker
  // implementation depends on. These lightweight polyfills make Evolu fall
  // back to a single-tab worker model instead of crashing during boot.
  if (typeof document === "undefined") return;

  const ensureBroadcastChannel = () => {
    const BC = globalThis.BroadcastChannel;
    if (typeof BC === "undefined") return false;
    try {
      const test = new BC("__linky_test__");
      test.close();
      return true;
    } catch {
      return false;
    }
  };

  if (!ensureBroadcastChannel()) {
    type Listener = BroadcastMessageHandler;
    const channelsByName = new Map<string, Set<PolyBroadcastChannel>>();

    class PolyBroadcastChannel implements BroadcastChannelLike {
      readonly name: string;
      onmessage: Listener = null;

      constructor(name: string) {
        this.name = name;
        const set = channelsByName.get(this.name) ?? new Set();
        set.add(this);
        channelsByName.set(this.name, set);
      }

      postMessage(message: JsonValue) {
        const set = channelsByName.get(this.name);
        if (!set) return;
        for (const ch of set) {
          const handler = ch.onmessage;
          if (!handler) continue;
          try {
            handler(new MessageEvent("message", { data: message }));
          } catch {
            // ignore
          }
        }
      }

      close() {
        const set = channelsByName.get(this.name);
        if (!set) return;
        set.delete(this);
        if (set.size === 0) channelsByName.delete(this.name);
      }

      // Evolu only assigns onmessage, so the EventTarget surface is inert.
      addEventListener() {}

      removeEventListener() {}

      dispatchEvent() {
        return false;
      }
    }

    Object.defineProperty(globalThis, "BroadcastChannel", {
      value: PolyBroadcastChannel,
      configurable: true,
      writable: true,
    });
  }

  const nav = navigator;
  const locks = nav.locks;

  if (!locks?.request) {
    const lockPolyfill: LockManagerLike = {
      request: async (_name: string, cb: () => Promise<JsonValue>) => cb(),
    };
    try {
      if (!Reflect.set(navigator, "locks", lockPolyfill))
        throw new Error("Cannot assign navigator.locks");
    } catch {
      try {
        Object.defineProperty(navigator, "locks", {
          value: lockPolyfill,
          configurable: true,
        });
      } catch {
        // ignore
      }
    }
  }
};
