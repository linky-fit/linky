import { AppData } from "@linky-fit/linkstr";
import type { AppDataDraft, AppDataQuery } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const publishAppDataAtom = linkstrRuntimeAtom.fn<AppDataDraft>()(
  (draft) => Effect.flatMap(AppData, (appData) => appData.publish(draft)),
);

export const fetchAppDataAtom = linkstrRuntimeAtom.fn<AppDataQuery>()((query) =>
  Effect.flatMap(AppData, (appData) => appData.fetch(query)),
);
