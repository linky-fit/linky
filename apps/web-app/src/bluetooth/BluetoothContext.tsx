/* eslint-disable react-refresh/only-export-components */
import React from "react";
import {
  BluetoothController,
  emptyBluetoothSnapshot,
  type BluetoothSnapshot,
} from "./controller";
import { hasNativeBluetooth, nativeBluetooth } from "./transport";

interface BluetoothContextValue extends BluetoothSnapshot {
  available: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
}

export const BluetoothContext = React.createContext<BluetoothContextValue>({
  ...emptyBluetoothSnapshot,
  available: false,
  setEnabled: async () => {},
  sendMessage: async () => {
    throw new Error("Bluetooth unavailable");
  },
});

interface BluetoothProviderProps {
  currentNsec: string;
  nickname: string;
  children: React.ReactNode;
}

export function BluetoothProvider({
  currentNsec,
  nickname,
  children,
}: BluetoothProviderProps) {
  const [snapshot, setSnapshot] = React.useState(emptyBluetoothSnapshot);
  const controller = React.useRef<BluetoothController | null>(null);
  const nicknameRef = React.useRef(nickname);
  const available = hasNativeBluetooth();

  React.useEffect(() => {
    nicknameRef.current = nickname;
    controller.current?.setNickname(nickname);
  }, [nickname]);

  React.useEffect(() => {
    const next = new BluetoothController(
      nativeBluetooth,
      available,
      currentNsec,
      nicknameRef.current,
    );
    controller.current = next;
    setSnapshot(next.getSnapshot());
    const unsubscribe = next.subscribe(() => setSnapshot(next.getSnapshot()));
    const onResume = () => {
      if (document.visibilityState !== "hidden") next.refresh();
    };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    next.watch();
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onResume);
      window.removeEventListener("focus", onResume);
      next.dispose();
      controller.current = null;
    };
  }, [available, currentNsec]);

  const setEnabled = React.useCallback(async (enabled: boolean) => {
    await controller.current?.setEnabled(enabled);
  }, []);
  const sendMessage = React.useCallback(async (text: string) => {
    if (!controller.current) throw new Error("Bluetooth unavailable");
    await controller.current.sendMessage(text);
  }, []);
  return (
    <BluetoothContext.Provider
      value={{ ...snapshot, available, setEnabled, sendMessage }}
    >
      {children}
    </BluetoothContext.Provider>
  );
}

export const useBluetooth = () => React.useContext(BluetoothContext);
