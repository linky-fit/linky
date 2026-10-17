import React from "react";
import { isOnline, onConnectivityChange } from "../platform/appEvents";

/** Whether the device reports a network connection, kept current. */
export const useOnline = (): boolean => {
  const [online, setOnline] = React.useState(isOnline);
  React.useEffect(() => onConnectivityChange(setOnline), []);
  return online;
};
