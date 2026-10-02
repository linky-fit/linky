import { MuteList } from "@linky-fit/linkstr";
import type { Pubkey } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const publishMuteListAtom = linkstrRuntimeAtom.fn<
  ReadonlyArray<Pubkey>
>()((pubkeys) =>
  Effect.flatMap(MuteList, (muteList) => muteList.publishMuteList(pubkeys)),
);

export const fetchOwnMuteListAtom = linkstrRuntimeAtom.fn<void>()(() =>
  Effect.flatMap(MuteList, (muteList) => muteList.fetchOwnMuteList()),
);
