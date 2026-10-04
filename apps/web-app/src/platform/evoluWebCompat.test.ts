import { afterEach, expect, it, vi } from "vitest";
import type { JsonValue } from "../types/json";
import { applyEvoluWebCompatPolyfills } from "./evoluWebCompat";

class BlockedBroadcastChannel {
  constructor() {
    throw new DOMException("Blocked", "SecurityError");
  }
}

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["missing", undefined],
  ["blocked", BlockedBroadcastChannel],
])(
  "replaces a %s BroadcastChannel with one that delivers in-page messages",
  (_state, channel) => {
    vi.stubGlobal("BroadcastChannel", channel);

    applyEvoluWebCompatPolyfills();

    const sender = new BroadcastChannel("evolu");
    const receiver = new BroadcastChannel("evolu");
    const received: JsonValue[] = [];
    receiver.onmessage = (event) => received.push(event.data);
    sender.postMessage({ type: "sync" });
    receiver.close();
    sender.postMessage({ type: "ignored" });

    expect(received).toEqual([{ type: "sync" }]);
  },
);
