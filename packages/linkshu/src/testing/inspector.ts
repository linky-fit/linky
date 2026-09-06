import { Layer, Stream } from "effect";
import type { LinkshuInspectorEvent } from "../inspector/events";
import { Inspector } from "../inspector/Inspector";
import type { InspectorService } from "../inspector/Inspector";

export interface RecordingInspector {
  readonly events: Array<LinkshuInspectorEvent>;
  readonly service: InspectorService;
  readonly layer: Layer.Layer<Inspector>;
}

/** Collects every emitted event in `events`, in order. */
export const recordingInspector = (): RecordingInspector => {
  const events: Array<LinkshuInspectorEvent> = [];
  const service: InspectorService = {
    emit: (build) => {
      events.push(build());
    },
    events: Stream.empty,
  };
  return { events, service, layer: Layer.succeed(Inspector, service) };
};
