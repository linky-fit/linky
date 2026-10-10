import { RegistryContext } from "@effect/atom-react";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import {
  AppData,
  AppMessages,
  BankOffers,
  MuteList,
  NostrConnect,
  Outbox,
  PaymentNotices,
  Profiles,
  Reactions,
  RelayLists,
  SeenReceipts,
  WrapInbox,
} from "@linky-fit/linkstr";
import type {
  AppDataDraft,
  AppDataQuery,
  AppMessageDraft,
  BankOfferDraft,
  DiscoverActiveProfilesOptions,
  NostrConnectRequest,
  OutboxRef,
  PaymentNoticeDraft,
  PaymentTelemetryDraft,
  ProfileMetadata,
  Pubkey,
  RelayListsDraft,
  RelayUrl,
  RetractionDraft,
  RumorFixedOperation,
  SearchProfilesOptions,
  SeenReceiptDraft,
  StatusDraft,
  WrapId,
} from "@linky-fit/linkstr";
import { Effect, Exit } from "effect";
import type { Fiber } from "effect";
import { useContext, useMemo } from "react";
import type { LinkstrNotConfigured } from "./errors";
import { linkstrRuntimeAtom } from "./runtime";

type LinkstrServices =
  typeof linkstrRuntimeAtom extends Atom.AtomRuntime<infer R, unknown>
    ? R
    : never;

/** Runs an effect once over the linkstr services; failures resolve as `Exit` values. */
export type LinkstrRun = <A, E>(
  effect: Effect.Effect<A, E, LinkstrServices>,
) => Promise<Exit.Exit<A, E | LinkstrNotConfigured>>;

export interface EnqueueOutboxInput {
  readonly op: RumorFixedOperation;
  readonly ref: OutboxRef;
}

export interface EnqueuePaymentTelemetryParams {
  readonly draft: PaymentTelemetryDraft;
  readonly recipient: Pubkey;
  readonly ref: OutboxRef;
}

export interface FetchWrapEventParams {
  readonly wrapId: WrapId;
  readonly extraRelays?: ReadonlyArray<RelayUrl>;
}

const makeLinkstrCommands = (run: LinkstrRun) => ({
  run,
  enqueueOutbox: ({ op, ref }: EnqueueOutboxInput) =>
    run(Effect.flatMap(Outbox, (outbox) => outbox.enqueue(op, ref))),
  /** Durable send: the outbox owns delivery, retries and the terminal result. */
  enqueuePaymentTelemetry: ({
    draft,
    recipient,
    ref,
  }: EnqueuePaymentTelemetryParams) =>
    run(
      Effect.flatMap(Outbox, (outbox) =>
        outbox.enqueueTelemetry(draft, recipient, ref),
      ),
    ),
  sendPaymentNotice: (draft: PaymentNoticeDraft) =>
    run(Effect.flatMap(PaymentNotices, (notices) => notices.send(draft))),
  sendSeenReceipt: (draft: SeenReceiptDraft) =>
    run(Effect.flatMap(SeenReceipts, (receipts) => receipts.send(draft))),
  sendBankOffer: (draft: BankOfferDraft) =>
    run(Effect.flatMap(BankOffers, (bankOffers) => bankOffers.send(draft))),
  sendAppMessage: (draft: AppMessageDraft) =>
    run(Effect.flatMap(AppMessages, (messages) => messages.send(draft))),
  retractReaction: (draft: RetractionDraft) =>
    run(Effect.flatMap(Reactions, (reactions) => reactions.retract(draft))),
  publishProfile: (metadata: ProfileMetadata) =>
    run(
      Effect.flatMap(Profiles, (profiles) => profiles.publishProfile(metadata)),
    ),
  publishStatus: (draft: StatusDraft) =>
    run(Effect.flatMap(Profiles, (profiles) => profiles.publishStatus(draft))),
  republishOwnProfile: () =>
    run(Effect.flatMap(Profiles, (profiles) => profiles.republishOwnProfile())),
  fetchProfile: (pubkey: Pubkey) =>
    run(Effect.flatMap(Profiles, (profiles) => profiles.fetchProfile(pubkey))),
  fetchProfiles: (pubkeys: ReadonlyArray<Pubkey>) =>
    run(
      Effect.flatMap(Profiles, (profiles) => profiles.fetchProfiles(pubkeys)),
    ),
  discoverActiveProfiles: (options?: DiscoverActiveProfilesOptions) =>
    run(
      Effect.flatMap(Profiles, (profiles) =>
        profiles.discoverActiveProfiles(options),
      ),
    ),
  searchProfiles: ({
    query,
    options,
  }: {
    readonly query: string;
    readonly options?: SearchProfilesOptions;
  }) =>
    run(
      Effect.flatMap(Profiles, (profiles) =>
        profiles.searchProfiles(query, options),
      ),
    ),
  publishRelayLists: (draft: RelayListsDraft) =>
    run(
      Effect.flatMap(RelayLists, (relayLists) =>
        relayLists.publishRelayLists(draft),
      ),
    ),
  fetchOwnRelayLists: () =>
    run(
      Effect.flatMap(RelayLists, (relayLists) =>
        relayLists.fetchOwnRelayLists(),
      ),
    ),
  publishMuteList: (pubkeys: ReadonlyArray<Pubkey>) =>
    run(
      Effect.flatMap(MuteList, (muteList) => muteList.publishMuteList(pubkeys)),
    ),
  fetchOwnMuteList: () =>
    run(Effect.flatMap(MuteList, (muteList) => muteList.fetchOwnMuteList())),
  fetchWrapEvent: ({ wrapId, extraRelays }: FetchWrapEventParams) =>
    run(
      Effect.flatMap(WrapInbox, (inbox) =>
        inbox.fetchWrapEvent(
          wrapId,
          extraRelays === undefined ? undefined : { extraRelays },
        ),
      ),
    ),
  nostrConnectLogin: (request: NostrConnectRequest) =>
    run(Effect.flatMap(NostrConnect, (connect) => connect.login(request))),
  publishAppData: (draft: AppDataDraft) =>
    run(Effect.flatMap(AppData, (appData) => appData.publish(draft))),
  fetchAppData: (query: AppDataQuery) =>
    run(Effect.flatMap(AppData, (appData) => appData.fetch(query))),
});

export type LinkstrCommands = ReturnType<typeof makeLinkstrCommands>;

/**
 * Runs effects on one runtime build; rebuilding the runtime interrupts the
 * runs still in flight on the old one. Kept alive so the runtime outlives
 * the component that started a run.
 */
const linkstrRunAtom = Atom.keepAlive(
  Atom.readable((get) =>
    AsyncResult.map(get(linkstrRuntimeAtom), (context) => {
      const running = new Set<Fiber.Fiber<unknown, unknown>>();
      get.addFinalizer(() => {
        for (const fiber of running) fiber.interruptUnsafe();
      });
      return <A, E>(
        effect: Effect.Effect<A, E, LinkstrServices>,
      ): Promise<Exit.Exit<A, E>> =>
        new Promise((resolve) => {
          const fiber = Effect.runForkWith(context)(effect);
          running.add(fiber);
          fiber.addObserver((exit) => {
            running.delete(fiber);
            resolve(exit);
          });
        });
    }),
  ),
);

/**
 * The linkstr operations over `registry`. Each call runs exactly once, on the
 * runtime current when the call starts (waiting while it builds), and
 * resolves with its own `Exit`.
 */
export const linkstrCommands = (
  registry: AtomRegistry.AtomRegistry,
): LinkstrCommands =>
  makeLinkstrCommands(async (effect) => {
    const run = await Effect.runPromiseExit(
      AtomRegistry.getResult(registry, linkstrRunAtom, {
        suspendOnWaiting: true,
      }),
    );
    return Exit.isSuccess(run) ? run.value(effect) : Exit.failCause(run.cause);
  });

/** `linkstrCommands` over the nearest registry; stable across renders. */
export const useLinkstrCommands = (): LinkstrCommands => {
  const registry = useContext(RegistryContext);
  return useMemo(() => linkstrCommands(registry), [registry]);
};
