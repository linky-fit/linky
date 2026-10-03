import {
  decodeNpub,
  identityFromNsec,
  type InboxDelivery,
  type Pubkey,
  type SupporterAward,
  type SupporterResultReceived,
} from "@linky-fit/linkstr";
import { publishProfileBadgeAtom, useAtomSet } from "@linky-fit/linkstr-react";
import {
  NonEmptyString,
  NonEmptyString100,
  PositiveInt,
  supporterAwardIdFor,
} from "@linky-fit/linksync";
import type { StoredOperation } from "@linky-fit/linkshu";
import { Cause, Effect, Exit, Option } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { useDeferredOnlineReady } from "../../hooks/useDeferredOnlineReady";
import { useLatest } from "../../hooks/useLatest";
import type { Translate } from "../../i18n";
import {
  safeLocalStorageGet,
  safeLocalStorageRemove,
  safeLocalStorageSet,
} from "../../utils/storage";
import { nowSeconds } from "../../utils/time";
import {
  allWrites,
  NO_WRITE,
  runWrite,
  type WriteOutcome,
} from "../lib/storeWrite";
import {
  linkyBotPubkey,
  SUPPORTER_TIER_LABEL_KEYS,
  supporterValiditySeconds,
} from "../lib/supporter";
import {
  encodeAwardEvent,
  profileBadgeAward,
  readSupporterResult,
  supporterResultNotice,
  type SupporterResultOutcome,
} from "../lib/supporterResults";
import { extractCashuTokenFromText } from "../lib/tokenText";
import type {
  AppendLocalNostrMessage,
  ContactRowLike,
  LocalNostrMessage,
} from "../types/appTypes";
import type { CashuTransferLifecycle } from "./composition/useLinkshuComposition";
import { buildUnknownContactId } from "./messages/contactIdentity";
import {
  useSettingsRepository,
  useSupporterAwardsRepository,
} from "./useLinksync";

export type HandleSupporterResult = (
  event: SupporterResultReceived,
  delivery: InboxDelivery,
) => Promise<WriteOutcome>;

/** Survives a reload, so a publish that failed is tried again on the next start. */
const PUBLISH_PENDING_STORAGE_KEY = "linky.supporterBadge.publishPending";
const PUBLISH_RETRY_MS = 60_000;

interface UseSupporterBadgesParams {
  appendLocalNostrMessage: AppendLocalNostrMessage;
  cashuOperations: ReadonlyArray<StoredOperation>;
  /** Null until the linkshu runtime is composed. */
  cashuTransferLifecycle: CashuTransferLifecycle | null;
  contacts: readonly ContactRowLike[];
  currentNsec: string | null;
  nostrMessagesLatestRef: React.RefObject<LocalNostrMessage[]>;
  /** Nostr may start: the account is hydrated and its identity settled. */
  nostrReady: boolean;
  pushToast: (message: string) => void;
  t: Translate;
}

const failureMessage = (cause: Cause.Cause<{ readonly _tag: string }>) =>
  Option.match(Cause.failureOption(cause), {
    onNone: () => Cause.pretty(cause),
    onSome: (failure) => failure._tag,
  });

const outcomeLabel = (outcome: SupporterResultOutcome): string =>
  outcome.kind === "refused" ? `refused (${outcome.reason})` : outcome.kind;

/**
 * The supporter's side of Linky Bot: handles its results (stores verified
 * awards, takes back a token from a mint it refuses, notes each result in its
 * conversation) and publishes the profile badge the display setting picks.
 * Only this device's own actions publish: storing a new award or changing
 * the setting; awards or settings synced from another device do not.
 */
export const useSupporterBadges = (params: UseSupporterBadgesParams) => {
  const { currentNsec, nostrReady } = params;
  const latest = useLatest(params);
  const me = React.useMemo(
    () =>
      currentNsec
        ? (identityFromNsec(currentNsec.trim())?.pubkey ?? null)
        : null,
    [currentNsec],
  );
  const awardsRepository = useSupporterAwardsRepository();
  const settingsRepository = useSettingsRepository();
  const publishProfileBadge = useAtomSet(publishProfileBadgeAtom, {
    mode: "promiseExit",
  });
  const onlineReady = useDeferredOnlineReady();

  const [requested, setRequested] = React.useState(() =>
    safeLocalStorageGet(PUBLISH_PENDING_STORAGE_KEY) === "1" ? 1 : 0,
  );
  const requestedRef = useLatest(requested);
  const publishedRef = React.useRef(0);
  const inFlightRef = React.useRef(false);
  const [attempt, setAttempt] = React.useState(0);

  const requestBadgePublish = React.useCallback(() => {
    safeLocalStorageSet(PUBLISH_PENDING_STORAGE_KEY, "1");
    setRequested((count) => count + 1);
  }, []);

  const storeAwards = React.useCallback(
    (
      event: SupporterResultReceived,
      awards: ReadonlyArray<SupporterAward>,
    ): Promise<WriteOutcome> =>
      runWrite(
        Effect.flatMap(
          Effect.forEach(awards, (award) =>
            awardsRepository.insertIfAbsent({
              id: supporterAwardIdFor(award.event.id),
              eventJson: NonEmptyString.orThrow(encodeAwardEvent(award.event)),
              badge: NonEmptyString100.orThrow(award.badge),
              awardedAtSec: PositiveInt.orThrow(award.awardedAt),
            }),
          ),
          (wrote) =>
            Effect.sync(() => {
              const stored = awards.filter((_, index) => wrote[index]);
              for (const award of stored) {
                reportAppLog({
                  tag: "supporter.badgeStored",
                  summary: `${award.badge} supporter badge stored`,
                  links: { rumor: event.resultId, award: award.event.id },
                  payload: { badge: award.badge, awardedAt: award.awardedAt },
                });
              }
              if (stored.length > 0) requestBadgePublish();
            }),
        ),
      ),
    [awardsRepository, requestBadgePublish],
  );

  /** Takes back the refused token; every device may try, the mint pays it out once. */
  const reclaimToken = React.useCallback(
    async (
      event: SupporterResultReceived,
      delivery: InboxDelivery,
    ): Promise<void> => {
      const {
        cashuOperations,
        cashuTransferLifecycle,
        nostrMessagesLatestRef,
      } = latest.current;
      const message = nostrMessagesLatestRef.current?.find(
        (candidate) =>
          candidate.direction === "out" &&
          candidate.rumorId === event.tokenMessageId,
      );
      const token = message ? extractCashuTokenFromText(message.content) : null;
      const operation = cashuOperations.find(
        (candidate) => token !== null && candidate.tokenText === token,
      );
      const links = { rumor: event.tokenMessageId };
      if (operation === undefined || cashuTransferLifecycle === null) {
        reportAppLog({
          tag: "supporter.tokenNotReclaimed",
          summary: "refused supporter payment not taken back",
          links,
          payload: {
            reason:
              message === undefined
                ? "message-missing"
                : operation === undefined
                  ? "transfer-missing"
                  : "wallet-not-ready",
          },
        });
        return;
      }
      try {
        const report = await cashuTransferLifecycle.reclaim(
          String(operation.id),
        );
        reportAppLog({
          tag: "supporter.tokenReclaimed",
          summary: `refused supporter payment taken back: ${report.reclaimedAmount} sat`,
          links: { ...links, operation: operation.id },
          payload: {
            reclaimedAmount: report.reclaimedAmount,
            reclaimedProofs: report.reclaimedProofs.length,
            spentProofs: report.spentProofs.length,
            unresolvedProofs: report.unresolvedProofs.length,
          },
        });
        if (delivery === "live" && report.reclaimedAmount > 0) {
          const { pushToast, t } = latest.current;
          pushToast(
            t("cashuReclaimDone")
              .replace("{amount}", String(report.reclaimedAmount))
              .replace("{proofs}", String(report.reclaimedProofs.length)),
          );
        }
      } catch (error) {
        reportAppLog({
          tag: "supporter.tokenNotReclaimed",
          summary: "refused supporter payment not taken back",
          links: { ...links, operation: operation.id },
          payload: { reason: "reclaim-failed", error: String(error) },
        });
      }
    },
    [latest],
  );

  const handleSupporterResult = React.useCallback<HandleSupporterResult>(
    async (event, delivery) => {
      if (linkyBotPubkey === null || me === null) return NO_WRITE;
      if (event.from !== linkyBotPubkey) return NO_WRITE;
      const { appendLocalNostrMessage, contacts, pushToast, t } =
        latest.current;
      const outcome = readSupporterResult(event, linkyBotPubkey, me);
      reportAppLog({
        tag: "supporter.resultReceived",
        summary: `supporter result: ${outcomeLabel(outcome)}`,
        links: { rumor: [event.resultId, event.tokenMessageId] },
        payload: {
          delivery,
          status: outcome.kind,
          ...(outcome.kind === "issued"
            ? {
                tier: outcome.tier,
                verified: outcome.awards.map((award) => award.badge),
                dropped: outcome.dropped,
              }
            : {}),
          ...(outcome.kind === "refused" ? { reason: outcome.reason } : {}),
        },
      });

      const text = t(supporterResultNotice(outcome)).replace(
        "{tier}",
        outcome.kind === "issued"
          ? t(SUPPORTER_TIER_LABEL_KEYS[outcome.tier])
          : "",
      );
      const contactId =
        contacts.find(
          (contact) => decodeNpub(contact.npub ?? "") === event.from,
        )?.id ?? buildUnknownContactId(event.from);
      const noticeWritten = contactId
        ? appendLocalNostrMessage({
            contactId,
            content: text,
            createdAtSec: event.sentAt,
            direction: "in",
            localOnly: true,
            pubkey: event.from,
            rumorId: event.resultId,
            wrapId: `supporter-result:${event.resultId}`,
          }).written
        : NO_WRITE;
      if (delivery === "live") pushToast(text);

      if (outcome.kind === "refused" && outcome.reason === "mint_not_accepted")
        await reclaimToken(event, delivery);
      return allWrites([
        noticeWritten,
        outcome.kind === "issued"
          ? storeAwards(event, outcome.awards)
          : NO_WRITE,
      ]);
    },
    [latest, me, reclaimToken, storeAwards],
  );

  const publishBadge = React.useCallback(
    async (issuer: Pubkey, supporter: Pubkey): Promise<boolean> => {
      const [records, display] = await Effect.runPromise(
        Effect.all([
          awardsRepository.all,
          settingsRepository.get("supporterBadgeDisplay"),
        ]),
      );
      const award = profileBadgeAward(records, display ?? "tier", {
        issuer,
        me: supporter,
        nowSec: nowSeconds(),
        validitySeconds: supporterValiditySeconds,
      });
      const exit = await publishProfileBadge({ issuer, award });
      if (Exit.isFailure(exit)) {
        reportAppLog({
          tag: "supporter.badgePublishFailed",
          summary: `supporter badge not published: ${failureMessage(exit.cause)}`,
          payload: { display, badge: award?.badge ?? null },
        });
        return false;
      }
      reportAppLog({
        tag: award ? "supporter.badgePublished" : "supporter.badgeWithdrawn",
        summary: award
          ? `${award.badge} supporter badge published`
          : "supporter badge withdrawn from the profile",
        links: {
          event: exit.value.eventId,
          ...(award ? { award: award.event.id } : {}),
        },
        payload: {
          display,
          badge: award?.badge ?? null,
          awardedAt: award?.awardedAt ?? null,
        },
      });
      return true;
    },
    [awardsRepository, publishProfileBadge, settingsRepository],
  );

  React.useEffect(() => {
    if (requested === publishedRef.current || inFlightRef.current) return;
    if (!nostrReady || !onlineReady) return;
    if (linkyBotPubkey === null || me === null) return;
    inFlightRef.current = true;
    const generation = requested;
    void publishBadge(linkyBotPubkey, me).then((published) => {
      inFlightRef.current = false;
      if (!published) {
        window.setTimeout(
          () => setAttempt((count) => count + 1),
          PUBLISH_RETRY_MS,
        );
        return;
      }
      publishedRef.current = generation;
      if (generation === requestedRef.current) {
        safeLocalStorageRemove(PUBLISH_PENDING_STORAGE_KEY);
      }
      // A request made while this one ran publishes next.
      setAttempt((count) => count + 1);
    });
  }, [
    attempt,
    me,
    nostrReady,
    onlineReady,
    publishBadge,
    requested,
    requestedRef,
  ]);

  return { handleSupporterResult, requestBadgePublish };
};
