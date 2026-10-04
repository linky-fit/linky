import { NostrConnect } from "@linky-fit/linkstr";
import type { NostrConnectRequest } from "@linky-fit/linkstr";
import { Effect } from "effect";
import { linkstrRuntimeAtom } from "./runtime";

export const nostrConnectLoginAtom =
  linkstrRuntimeAtom.fn<NostrConnectRequest>()((request) =>
    Effect.flatMap(NostrConnect, (connect) => connect.login(request)),
  );
