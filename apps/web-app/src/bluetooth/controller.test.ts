import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeNsec } from "@linky/linkstr";
import { makeIdentity } from "@linky/linkstr/testing";
import { BluetoothController } from "./controller";
import type { BluetoothState, BluetoothTransport } from "./transport";

vi.mock("../platform/secretStorage", () => ({
  readStoredSecret: async () => null,
  writeStoredSecret: async () => {},
}));
vi.mock("../devtools/inspector/inspectorEnabled", () => ({
  getInspectorEmissionEnabled: () => false,
}));

class FakeBluetooth implements BluetoothTransport {
  state: BluetoothState = {
    supported: true,
    permission: "granted",
    powered: true,
    active: false,
  };
  listeners = new Map<string, Set<(event: unknown) => void>>();
  remote: FakeBluetooth | null = null;
  start = vi.fn(async () => {
    // A native startup callback can arrive before advertising finishes.
    this.emit("state", { ...this.state, active: false });
    this.state = { ...this.state, active: true };
    this.emit("state", this.state);
    return this.state;
  });
  stop = vi.fn(async () => {
    this.state = { ...this.state, active: false };
    this.emit("state", this.state);
    return this.state;
  });
  async getState() {
    return this.state;
  }
  async requestPermissions() {
    return this.state;
  }
  async addListener(event: string, callback: (data: unknown) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(callback);
    this.listeners.set(event, listeners);
    return {
      remove: async () => {
        listeners.delete(callback);
      },
    };
  }
  emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((callback) => callback(data));
  }
  async send(packet: Parameters<BluetoothTransport["send"]>[0]) {
    this.remote?.emit("packet", { ...packet, peerId: "direct" });
  }
  connect(remote: FakeBluetooth) {
    this.remote = remote;
    remote.remote = this;
    const event = {
      id: "direct",
      connected: true,
      identity: true,
      maxPacketSize: 185,
    };
    this.emit("peer", event);
    remote.emit("peer", event);
  }
}

const controllers: BluetoothController[] = [];
const createController = (transport: FakeBluetooth, available = true) => {
  const controller = new BluetoothController(
    transport,
    available,
    encodeNsec(makeIdentity().secretKey),
    "Alice",
  );
  controllers.push(controller);
  controller.watch();
  return controller;
};
afterEach(async () => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  await new Promise((resolve) => setTimeout(resolve, 0));
  localStorage.clear();
});

describe("Bluetooth controller", () => {
  it("never starts from permission alone or in a PWA", async () => {
    const native = new FakeBluetooth();
    const controller = createController(native);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().state.supported).toBe(true),
    );
    expect(native.start).not.toHaveBeenCalled();
    const web = new FakeBluetooth();
    const pwa = createController(web, false);
    await pwa.setEnabled(true);
    expect(web.start).not.toHaveBeenCalled();
  });

  it("keeps denied permission off and resumes an opted-in powered-off device", async () => {
    const native = new FakeBluetooth();
    native.state = { ...native.state, permission: "denied" };
    const controller = createController(native);
    await controller.setEnabled(true);
    expect(controller.getSnapshot().enabled).toBe(false);
    native.state = { ...native.state, permission: "granted", powered: false };
    await controller.setEnabled(true);
    expect(controller.getSnapshot().enabled).toBe(true);
    expect(native.start).not.toHaveBeenCalled();
    native.state = { ...native.state, powered: true };
    native.emit("state", native.state);
    await vi.waitFor(() =>
      expect(controller.getSnapshot().state.active).toBe(true),
    );
  });

  it("verifies direct Linky identities, exchanges a public message, and clears presence on disable", async () => {
    const a = new FakeBluetooth();
    const b = new FakeBluetooth();
    const alice = createController(a);
    const bob = createController(b);
    await alice.setEnabled(true);
    await bob.setEnabled(true);
    a.connect(b);
    await vi.waitFor(
      () => {
        expect(alice.getSnapshot().nearby).toHaveLength(1);
        expect(bob.getSnapshot().nearby).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    await alice.sendMessage("Hello from Linky");
    await vi.waitFor(() =>
      expect(
        bob
          .getSnapshot()
          .messages.some((message) => message.text === "Hello from Linky"),
      ).toBe(true),
    );
    await alice.setEnabled(false);
    expect(alice.getSnapshot().nearby).toEqual([]);
    expect(alice.getSnapshot().messages).toEqual([]);
    expect(alice.getSnapshot().state.active).toBe(false);
  });
});
