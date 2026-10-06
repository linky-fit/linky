import { AppMessages } from "@linky-fit/linkstr";
import type { AppMessageDraft } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const sendAppMessageAtom = linkstrRuntimeAtom.fn<AppMessageDraft>()(
  (draft) => Effect.flatMap(AppMessages, (messages) => messages.send(draft)),
);
