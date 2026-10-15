import {
  pairCompany,
  parseJoinUrl,
  type CompanySnapshot,
  type JoinRequest,
} from "@linky-fit/keryx";
import { keryxSubscriptionIdFor } from "@linky-fit/linksync";
import { Effect, Result } from "effect";
import React from "react";
import { navigateTo } from "../../hooks/useRouting";
import type { I18nKey } from "../../i18n";
import {
  peekKeryxJoinOffer,
  subscribeKeryxJoinOffer,
  takeKeryxJoinOffer,
} from "../lib/keryxJoinOffer";
import { keryxPairFailedRow, reportKeryx } from "../lib/keryxInspector";
import {
  joinErrorKey,
  pairErrorKey,
  suggestedChannels,
} from "../lib/keryxPairing";
import { useKeryx } from "./useKeryx";

export type PairingStep =
  | { readonly step: "input" }
  | { readonly step: "confirm"; readonly request: JoinRequest }
  | {
      readonly step: "consent";
      readonly request: JoinRequest;
      readonly snapshot: CompanySnapshot;
      readonly channels: ReadonlySet<string>;
    };

/** Add company: join URL, origin confirmation, then consent to channels. */
export const useKeryxPairing = () => {
  const keryx = useKeryx();
  const [step, setStep] = React.useState<PairingStep>({ step: "input" });
  const [error, setError] = React.useState<I18nKey | null>(null);
  const [busy, setBusy] = React.useState(false);

  /** A rebranded company is paired again from scratch; any other paired origin is already confirmed. */
  const openPaired = React.useCallback(
    async (request: JoinRequest): Promise<boolean> => {
      const paired = keryx.companies.find(
        (company) => company.subscription.origin === request.origin,
      );
      if (!paired || keryx.entryOf(paired).status === "rebranded") return false;
      await keryx.addPrivateFeeds(paired, request.privateFeeds);
      navigateTo({ route: "keryxCompany", id: paired.id });
      return true;
    },
    [keryx],
  );

  const submit = React.useCallback(
    async (text: string) => {
      setError(null);
      const parsed = parseJoinUrl(text);
      if (Result.isFailure(parsed)) {
        setError(joinErrorKey(parsed.failure));
        return;
      }
      if (await openPaired(parsed.success)) return;
      setStep({ step: "confirm", request: parsed.success });
    },
    [openPaired],
  );

  const offer = React.useSyncExternalStore(
    subscribeKeryxJoinOffer,
    peekKeryxJoinOffer,
  );
  React.useEffect(() => {
    const text = offer === null ? null : takeKeryxJoinOffer();
    if (text !== null) void submit(text);
  }, [offer, submit]);

  const confirm = async () => {
    if (step.step !== "confirm") return;
    const { request } = step;
    setError(null);
    // The subscriptions may have loaded only after the join URL was submitted.
    if (await openPaired(request)) return;
    setBusy(true);
    const outcome = await Effect.runPromise(
      Effect.result(
        pairCompany({
          origin: request.origin,
          privateFeeds: request.privateFeeds,
          fetch: globalThis.fetch,
          now: new Date(),
        }),
      ),
    );
    setBusy(false);
    if (Result.isFailure(outcome)) {
      reportKeryx(() => [keryxPairFailedRow(request.origin, outcome.failure)]);
      setError(pairErrorKey(outcome.failure));
      return;
    }
    setStep({
      step: "consent",
      request,
      snapshot: outcome.success,
      channels: suggestedChannels(request, outcome.success),
    });
  };

  const toggleChannel = (name: string) => {
    if (step.step !== "consent") return;
    const channels = new Set(step.channels);
    if (!channels.delete(name)) channels.add(name);
    setStep({ ...step, channels });
  };

  const subscribe = async () => {
    if (step.step !== "consent") return;
    const { snapshot, channels } = step;
    setBusy(true);
    const outcome = await keryx.pair(
      snapshot,
      snapshot.catalog.flatMap((channel) =>
        channels.has(channel.name) ? [channel.name] : [],
      ),
    );
    setBusy(false);
    if (!outcome.ok) {
      setError("keryxPairFailed");
      return;
    }
    navigateTo({
      route: "keryxCompany",
      id: keryxSubscriptionIdFor(snapshot.origin),
    });
  };

  const cancel = () => {
    setError(null);
    setStep({ step: "input" });
  };

  return {
    step,
    error,
    busy,
    submit,
    confirm,
    cancel,
    toggleChannel,
    subscribe,
  };
};
