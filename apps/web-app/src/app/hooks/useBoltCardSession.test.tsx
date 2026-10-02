import {
  decodeCardMessage,
  encodeBridgeMessage,
  parseBoltCard,
  verifyBridgeChallenge,
  type BridgeMessage,
  type CardMessage,
} from "@linky-fit/bolt-card";
import { act } from "react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeBoltCardEvent } from "../../platform/nativeBridge";
import { makeLightningInvoice } from "../../testUtils/lightningInvoice";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import { removeBoltCard } from "../lib/boltCardStorage";
import { estimateMaxWithdrawableSat } from "../lib/boltCardTapSession";
import {
  BRIDGE_CONNECT_TIMEOUT_MS,
  BRIDGE_RECONNECT_ATTEMPTS,
  BRIDGE_RECONNECT_DELAY_MS,
  useBoltCardSession,
} from "./useBoltCardSession";

interface NativeState {
  supported: boolean;
  listener: ((event: NativeBoltCardEvent) => void) | null;
  startedUrls: string[];
  servedUrls: string[];
  stopped: number;
  /** Whether native still serves the card; a stop clears it like the HCE service. */
  serving: boolean;
  secrets: Map<string, string>;
}

const native = vi.hoisted(
  (): NativeState => ({
    supported: true,
    listener: null,
    startedUrls: [],
    servedUrls: [],
    stopped: 0,
    serving: true,
    secrets: new Map(),
  }),
);

vi.mock("../../platform/nativeBridge", () => ({
  supportsNativeBoltCard: () => native.supported,
  listenNativeBoltCard: (listener: (event: NativeBoltCardEvent) => void) => {
    native.listener = listener;
    return () => {
      native.listener = null;
    };
  },
  startNativeBoltCard: (url: string) => {
    native.startedUrls.push(url);
    return true;
  },
  setNativeBoltCardUrl: (url: string) => {
    if (!native.serving) return false;
    native.servedUrls.push(url);
    return true;
  },
  stopNativeBoltCard: () => {
    native.stopped += 1;
  },
  readAndroidStoredSecret: async (key: string) => native.secrets.get(key),
  writeAndroidStoredSecret: async (key: string, value: string) => {
    native.secrets.set(key, value);
    return true;
  },
  removeAndroidStoredSecret: async (key: string) => native.secrets.delete(key),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: CardMessage[] = [];
  closed = false;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(text: string): void {
    const message = decodeCardMessage(text);
    if (message === null) throw new Error(`card sent malformed ${text}`);
    this.sent.push(message);
  }

  close(code = 1000): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.({ code });
  }

  receive(message: BridgeMessage): void {
    this.onmessage?.({ data: encodeBridgeMessage(message) });
  }
}

const challenge = "ab".repeat(32);
const spendableSat = 10_000;
// Far enough in the future that the fixture invoice has not expired.
const longExpiry = 400_000_000;

const tapParams = (url: string) => {
  const params = new URL(url).searchParams;
  return { p: params.get("p") ?? "", c: params.get("c") ?? "" };
};

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const setup = async () => {
  const onInvoice = vi.fn<(invoice: string) => void>();
  const sessionRef: {
    current: ReturnType<typeof useBoltCardSession> | null;
  } = { current: null };
  const Probe = (): null => {
    const session = useBoltCardSession({
      bridgeUrl: "http://bridge.test",
      spendableSat,
      onInvoice,
    });
    React.useEffect(() => {
      sessionRef.current = session;
    }, [session]);
    return null;
  };
  const rendered = await renderIntoDocument(<Probe />);
  await act(async () => {
    await sessionRef.current?.start();
  });
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("no socket opened");
  return { onInvoice, rendered, sessionRef, socket };
};

const armCard = async (socket: FakeWebSocket) => {
  await act(async () => socket.receive({ _tag: "challenge", challenge }));
  await act(async () => socket.receive({ _tag: "ready" }));
  await flush();
  await act(async () =>
    native.listener?.({ status: "started", message: null }),
  );
};

describe("useBoltCardSession", () => {
  beforeEach(async () => {
    // Drops the card the storage module caches across tests.
    await removeBoltCard();
    native.supported = true;
    native.listener = null;
    native.startedUrls = [];
    native.servedUrls = [];
    native.stopped = 0;
    native.serving = true;
    native.secrets = new Map();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves taps, answers the POS and hands over the accepted invoice", async () => {
    const { onInvoice, rendered, sessionRef, socket } = await setup();
    expect(socket.url).toBe("ws://bridge.test/session");

    await armCard(socket);
    const auth = socket.sent[0];
    expect(auth?._tag).toBe("auth");
    if (auth?._tag === "auth") {
      expect(
        verifyBridgeChallenge(auth.cardId, challenge, auth.signature),
      ).toBe(true);
    }
    expect(native.startedUrls).toHaveLength(1);
    expect(sessionRef.current?.phase.kind).toBe("ready");

    // Every NFC read persists the next counter before serving its URL.
    await act(async () => native.listener?.({ status: "read", message: null }));
    await flush();
    expect(native.servedUrls).toHaveLength(1);
    const stored = parseBoltCard([...native.secrets.values()][0] ?? "");
    expect(stored?.counter).toBe(2);

    await act(async () =>
      socket.receive({
        _tag: "withdraw",
        id: "1",
        ...tapParams(native.startedUrls[0] ?? ""),
      }),
    );
    const offer = socket.sent.at(-1);
    expect(offer).toMatchObject({
      _tag: "offer",
      id: "1",
      maxWithdrawable: estimateMaxWithdrawableSat(spendableSat) * 1_000,
    });
    const k1 = offer?._tag === "offer" ? offer.k1 : "";

    const invoice = makeLightningInvoice("20u", longExpiry);
    await act(async () =>
      socket.receive({ _tag: "callback", id: "2", k1, pr: invoice }),
    );
    expect(socket.sent.at(-1)).toEqual({ _tag: "accepted", id: "2" });
    expect(onInvoice).toHaveBeenCalledWith(invoice);
    expect(sessionRef.current?.phase).toEqual({
      kind: "paying",
      amountSat: 2_000,
    });
    expect(socket.closed).toBe(true);
    expect(native.stopped).toBeGreaterThan(0);
    await rendered.unmount();
  });

  it("arms NFC without waiting for the bridge", async () => {
    const { rendered, sessionRef, socket } = await setup();
    // No challenge has arrived yet, and the card is already being served.
    expect(socket.sent).toEqual([]);
    expect(native.startedUrls).toHaveLength(1);
    await act(async () =>
      native.listener?.({ status: "started", message: null }),
    );
    expect(sessionRef.current?.phase.kind).toBe("ready");
    await rendered.unmount();
  });

  it("reconnects after a dropped bridge connection and keeps the card on", async () => {
    const { rendered, sessionRef, socket } = await setup();
    await armCard(socket);
    await act(async () => socket.close(1006));
    expect(sessionRef.current?.phase.kind).toBe("ready");
    expect(native.stopped).toBe(0);

    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, BRIDGE_RECONNECT_DELAY_MS + 20),
      );
    });
    const reconnected = FakeWebSocket.instances.at(-1);
    expect(reconnected).not.toBe(socket);
    await act(async () =>
      reconnected?.receive({ _tag: "challenge", challenge }),
    );
    expect(reconnected?.sent[0]?._tag).toBe("auth");
    await rendered.unmount();
  });

  it("gives up when the bridge refuses the card for good", async () => {
    const { rendered, sessionRef, socket } = await setup();
    await armCard(socket);
    // 4004: a newer session took this card over on the bridge.
    await act(async () => socket.close(4004));
    expect(sessionRef.current?.phase).toEqual({
      kind: "failed",
      error: "bridge",
    });
    expect(native.stopped).toBeGreaterThan(0);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await rendered.unmount();
  });

  it("switches the card off after the reconnects run out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { rendered, sessionRef, socket } = await setup();
      await act(async () => socket.close(1006));
      for (
        let attempt = 1;
        attempt <= BRIDGE_RECONNECT_ATTEMPTS;
        attempt += 1
      ) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(
            BRIDGE_RECONNECT_DELAY_MS * attempt,
          );
        });
        await act(async () => FakeWebSocket.instances.at(-1)?.close(1006));
      }
      expect(FakeWebSocket.instances).toHaveLength(
        BRIDGE_RECONNECT_ATTEMPTS + 1,
      );
      expect(sessionRef.current?.phase).toEqual({
        kind: "failed",
        error: "bridge",
      });
      expect(native.stopped).toBeGreaterThan(0);
      await rendered.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches the card off when the bridge never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { rendered, sessionRef } = await setup();
      await act(async () =>
        native.listener?.({ status: "started", message: null }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BRIDGE_CONNECT_TIMEOUT_MS);
      });
      expect(sessionRef.current?.phase).toEqual({
        kind: "failed",
        error: "bridge",
      });
      expect(native.stopped).toBeGreaterThan(0);
      await rendered.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends when the app pauses and the native side stops the card", async () => {
    const { rendered, sessionRef, socket } = await setup();
    await armCard(socket);
    await act(async () =>
      native.listener?.({ status: "stopped", message: null }),
    );
    expect(sessionRef.current?.phase).toEqual({ kind: "ended" });
    expect(socket.closed).toBe(true);
    await rendered.unmount();
  });

  it("reports a device without card emulation", async () => {
    native.supported = false;
    const onInvoice = vi.fn<(invoice: string) => void>();
    const sessionRef: {
      current: ReturnType<typeof useBoltCardSession> | null;
    } = { current: null };
    const Probe = (): null => {
      const session = useBoltCardSession({
        bridgeUrl: "http://bridge.test",
        spendableSat,
        onInvoice,
      });
      React.useEffect(() => {
        sessionRef.current = session;
      }, [session]);
      return null;
    };
    const rendered = await renderIntoDocument(<Probe />);
    await act(async () => {
      await sessionRef.current?.start();
    });
    expect(sessionRef.current?.phase).toEqual({
      kind: "failed",
      error: "unsupported",
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    await rendered.unmount();
  });

  it("ends instead of re-arming when native stopped during a counter save", async () => {
    const { rendered, sessionRef, socket } = await setup();
    await armCard(socket);
    // The app paused and native cleared the URL; the stopped event is still queued.
    native.serving = false;
    await act(async () => native.listener?.({ status: "read", message: null }));
    await flush();
    expect(native.servedUrls).toEqual([]);
    expect(sessionRef.current?.phase).toEqual({ kind: "ended" });
    expect(socket.closed).toBe(true);
    await rendered.unmount();
  });
});
