import { Inspector } from "@linky-fit/linkshu";
import type { LinkshuInspectorEvent } from "@linky-fit/linkshu";
import { Layer, Stream } from "effect";

const format = ({ _tag, ...fields }: LinkshuInspectorEvent): string =>
  `[linkshu] ${_tag} ${JSON.stringify(fields)}`;

/**
 * The whole `--verbose` implementation: every diagnostic as one stderr line,
 * so stdout stays the command's result. `events` is empty because nothing
 * downstream consumes the stream here.
 */
export const stderrInspector: Layer.Layer<Inspector> = Layer.succeed(
  Inspector,
  {
    emit: (build) => {
      // `emit` is total by contract: a throwing builder is dropped, never a
      // defect of the observed operation.
      try {
        process.stderr.write(`${format(build())}\n`);
      } catch (error) {
        console.warn("linkshu inspector emission failed", error);
      }
    },
    events: Stream.empty,
  },
);
