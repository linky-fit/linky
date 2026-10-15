import { Inspector } from "@linky-fit/linkshu";
import { Layer, Stream } from "effect";
import { getInspectorEmissionEnabled } from "./inspectorEnabled";
import { linkshuEventToRow } from "./linkshuRows";
import { reportInspectorRows } from "./reportInspectorRows";

/**
 * linkshu's `Inspector` bridged onto the app inspector pipeline: every event
 * becomes one `cashu`-channel row. The emission gate keeps a disabled
 * inspector at one boolean per event; `events` is empty because rows flow
 * through `reportInspectorRows`, not the stream.
 */
export const linkshuAppInspector: Layer.Layer<Inspector> = Layer.succeed(
  Inspector,
  {
    emit: (build) => {
      if (!getInspectorEmissionEnabled()) return;
      // `emit` is total by contract: a throwing builder or mapper is dropped,
      // never a defect of the observed operation.
      try {
        reportInspectorRows([linkshuEventToRow(build(), Date.now())]);
      } catch (error) {
        console.warn("[linky] linkshu inspector row mapping failed", error);
      }
    },
    events: Stream.empty,
  },
);
