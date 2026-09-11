import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from "@capacitor/core";
import { Schema } from "effect";
import { isNativePlatform } from "../platform/runtime";

export const BluetoothState = Schema.Struct({
  supported: Schema.Boolean,
  permission: Schema.Literal("prompt", "granted", "denied"),
  powered: Schema.Boolean,
  active: Schema.Boolean,
});
export type BluetoothState = typeof BluetoothState.Type;
export const BluetoothPeer = Schema.Struct({
  id: Schema.String.pipe(Schema.maxLength(200)),
  connected: Schema.Boolean,
  identity: Schema.Boolean,
  maxPacketSize: Schema.Int.pipe(Schema.between(20, 512)),
});
export type BluetoothPeer = typeof BluetoothPeer.Type;
export const BluetoothPacket = Schema.Struct({
  peerId: Schema.String.pipe(Schema.maxLength(200)),
  lane: Schema.Literal("mesh", "identity"),
  data: Schema.String.pipe(Schema.maxLength(1400000)),
});
export const BluetoothError = Schema.Struct({ message: Schema.String });

export interface BluetoothTransport {
  getState(): Promise<BluetoothState>;
  requestPermissions(): Promise<BluetoothState>;
  start(): Promise<BluetoothState>;
  stop(): Promise<BluetoothState>;
  send(options: {
    peerId: string;
    lane: "mesh" | "identity";
    data: string;
  }): Promise<void>;
  addListener(
    eventName: "state" | "peer" | "packet" | "error",
    listener: (event: unknown) => void,
  ): Promise<PluginListenerHandle>;
}

export const nativeBluetooth =
  registerPlugin<BluetoothTransport>("LinkyBluetooth");
export const hasNativeBluetooth = () =>
  isNativePlatform() && Capacitor.isPluginAvailable("LinkyBluetooth");
export const inactiveBluetoothState: BluetoothState = {
  supported: false,
  permission: "prompt",
  powered: false,
  active: false,
};

export const decodeBluetoothState = Schema.decodeUnknownSync(BluetoothState);
