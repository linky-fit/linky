import {
  inspectorEventsAtom,
  inspectorHandlerAtom,
  useAtomMount,
  useAtomSet,
} from "@linky-fit/linkstr-react";
import React from "react";
import { useInspectorEmissionEnabled } from "./inspectorEnabled";
import { linkstrEventToRow } from "./linkstrRows";
import { reportInspectorRows } from "./reportInspectorRows";

export const useLinkstrInspectorBridge = () => {
  const inspectorEmissionEnabled = useInspectorEmissionEnabled();
  const setHandler = useAtomSet(inspectorHandlerAtom);
  useAtomMount(inspectorEventsAtom);

  React.useEffect(() => {
    if (!inspectorEmissionEnabled) return;
    setHandler({
      onEvent: (event) => {
        // A mapping throw would kill the linkstr feed fiber and silently drop
        // every later event; a lost row is the lesser failure.
        try {
          reportInspectorRows([linkstrEventToRow(event, Date.now())]);
        } catch (error) {
          console.warn("[linky] inspector row mapping failed", error);
        }
      },
    });
    return () => setHandler(null);
  }, [inspectorEmissionEnabled, setHandler]);
};
