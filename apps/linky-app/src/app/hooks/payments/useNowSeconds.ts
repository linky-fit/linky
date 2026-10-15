import React from "react";
import { nowSeconds } from "../../../utils/time";

/** Current time in seconds, refreshed every second while `active`. */
export const useNowSeconds = (active: boolean): number => {
  const [now, setNow] = React.useState(nowSeconds);
  React.useEffect(() => {
    if (!active) return;
    setNow(nowSeconds());
    const interval = window.setInterval(() => setNow(nowSeconds()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);
  return now;
};
