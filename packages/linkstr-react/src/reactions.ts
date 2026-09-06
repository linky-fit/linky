import { Reactions } from "@linky/linkstr";
import type { RetractionDraft } from "@linky/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const retractReactionAtom = linkstrRuntimeAtom.fn<RetractionDraft>()(
  (draft) => Effect.flatMap(Reactions, (reactions) => reactions.retract(draft)),
);
