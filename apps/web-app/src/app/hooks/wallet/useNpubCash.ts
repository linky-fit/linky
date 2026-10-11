import {
  RegistryContext,
  useAtomSuspense,
  useAtomValue,
} from "@linky-fit/linkstr-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import React from "react";
import { useLatest } from "../../../hooks/useLatest";
import type { PushToastOptions } from "../../../hooks/useToasts";
import type { Translate } from "../../../i18n";
import type { Route } from "../../../types/route";
import type { DisplayAmountParts } from "../../../utils/displayAmounts";
import { normalizeMintUrl } from "../../../utils/mint";
import { parseNpubCashProfileInfo } from "../../../utils/npubCashInfo";
import { isNpubCashDisabled } from "../../../utils/npubCashServer";
import { asRecord } from "../../../utils/validation";
import type { PaidOverlayDetails } from "../../lib/paidOverlay";
import { touchReceivingMint } from "../../lib/receivingMint";
import {
  defaultMintCommandsAtom,
  type DefaultMintChoice,
} from "../../state/wallet/defaultMint";
import {
  fetchNpubCashInfo,
  makeNpubCashAuthHeader,
  npubCashCommandsAtom,
  npubCashSyncedMintAtom,
  updateNpubCashMint,
  type NpubCashClaimEvents,
} from "../../state/wallet/npubCash";
import { currentNpubAtom, currentNsecAtom } from "../../state/session/session";
import { usePushToast, useSetStatus, useTranslation } from "../shell";
import type { LocalMintInfoRow } from "../../types/appTypes";

/** Signs npub.cash calls with the session's nostr key. */
export const useNpubCashAuthHeader = () => {
  const currentNsec = useAtomValue(currentNsecAtom);
  return React.useCallback(
    (url: string, method: string, payload?: Record<string, string>) =>
      makeNpubCashAuthHeader(currentNsec, url, method, payload),
    [currentNsec],
  );
};

const INFO_REFRESH_MS = 10 * 60_000;
const CLAIM_POLL_MS = 30_000;
const TOPUP_CLAIM_POLL_MS = 5_000;

interface UseNpubCashParams {
  copyText: (value: string) => Promise<void>;
  currentNpub: string | null;
  currentNsec: string | null;
  defaultMintChoice: DefaultMintChoice;
  formatDisplayedAmountParts: (amountSat: number) => DisplayAmountParts;
  isMintDeleted: (mintUrl: string) => boolean;
  maybeShowPwaNotification: (
    title: string,
    body: string,
    tag?: string,
  ) => Promise<void>;
  mintInfoByUrl: ReadonlyMap<string, LocalMintInfoRow>;
  /** Off until the Nostr bootstrap finished; npub.cash is network catch-up. */
  networkEnabled: boolean;
  npubCashInfoInFlightRef: React.RefObject<boolean>;
  npubCashInfoLoadedAtMsRef: React.RefObject<number>;
  npubCashInfoLoadedForNpubRef: React.RefObject<string | null>;
  pushToast: (message: string, options?: PushToastOptions) => void;
  refreshMintInfo: (mintUrl: string) => Promise<void> | void;
  rememberCashuTokenKnown: (...tokens: readonly string[]) => void;
  routeKind: Route["kind"];
  setIsProfileEditing: (editing: boolean) => void;
  setOwnedProfileLightningAddresses: (addresses: string[]) => void;
  setOwnedProfileLightningAddressesLoading: (loading: boolean) => void;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  showPaidOverlay: (title?: string, details?: PaidOverlayDetails) => void;
  suggestDefaultMint: (mint: string) => void;
  t: Translate;
  touchMintInfo: (mintUrl: string, nowSec: number) => void;
}

const isUrl = (value: string): boolean => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const readInfoMintUrl = (info: unknown): string => {
  const root = asRecord(info);
  if (!root) return "";
  const direct = String(root.mintUrl ?? "").trim();
  if (direct) return direct;
  const wrapped = asRecord(root.data);
  return wrapped ? String(wrapped.mintUrl ?? wrapped.mintURL ?? "").trim() : "";
};

/**
 * The hosted npub.cash integration: the default mint kept there, the
 * lightning addresses it owns for the user, and the payments to them,
 * claimed on launch, every 30 s and every 5 s while a topup invoice shows.
 */
export const useNpubCash = ({
  copyText,
  currentNpub,
  currentNsec,
  defaultMintChoice,
  formatDisplayedAmountParts,
  isMintDeleted,
  maybeShowPwaNotification,
  mintInfoByUrl,
  networkEnabled,
  npubCashInfoInFlightRef,
  npubCashInfoLoadedAtMsRef,
  npubCashInfoLoadedForNpubRef,
  pushToast,
  refreshMintInfo,
  rememberCashuTokenKnown,
  routeKind,
  setIsProfileEditing,
  setOwnedProfileLightningAddresses,
  setOwnedProfileLightningAddressesLoading,
  setStatus,
  showPaidOverlay,
  suggestDefaultMint,
  t,
  touchMintInfo,
}: UseNpubCashParams) => {
  const commands = Option.getOrNull(
    AsyncResult.value(useAtomValue(npubCashCommandsAtom)),
  );
  const registry = React.useContext(RegistryContext);

  // A choice made on another device reaches npub.cash from here.
  React.useEffect(() => {
    const cleaned = normalizeMintUrl(defaultMintChoice.mint ?? "");
    if (!cleaned || !defaultMintChoice.chosen) return;
    if (registry.get(npubCashSyncedMintAtom) === cleaned) return;
    registry.set(npubCashSyncedMintAtom, cleaned);
    void updateNpubCashMint({ currentNpub, currentNsec, mint: cleaned }).catch(
      () => {
        registry.set(npubCashSyncedMintAtom, null);
      },
    );
  }, [currentNpub, currentNsec, defaultMintChoice, registry]);

  React.useEffect(() => {
    setOwnedProfileLightningAddresses([]);
    if (isNpubCashDisabled() || !currentNpub || !currentNsec) {
      setOwnedProfileLightningAddressesLoading(false);
      return;
    }
    setOwnedProfileLightningAddressesLoading(true);
    const controller = new AbortController();
    void fetchNpubCashInfo(currentNsec, controller.signal)
      .then(
        (info) =>
          info === null
            ? []
            : parseNpubCashProfileInfo(info).ownedLightningAddresses,
        () => [],
      )
      .then((addresses) => {
        if (controller.signal.aborted) return;
        setOwnedProfileLightningAddresses(addresses);
        setOwnedProfileLightningAddressesLoading(false);
      });
    return () => controller.abort();
  }, [
    currentNpub,
    currentNsec,
    setOwnedProfileLightningAddresses,
    setOwnedProfileLightningAddressesLoading,
  ]);

  const claimEvents = React.useMemo<NpubCashClaimEvents>(
    () => ({
      onReceived: ({ amount, knownTokens, mint }) => {
        rememberCashuTokenKnown(...knownTokens);
        touchReceivingMint(mint, {
          isMintDeleted,
          mintInfoByUrl,
          refreshMintInfo,
          touchMintInfo,
        });
        const display = amount > 0 ? formatDisplayedAmountParts(amount) : null;
        if (routeKind !== "topupInvoice") {
          showPaidOverlay(
            display === null
              ? t("cashuAccepted")
              : t("paidReceived")
                  .replace(
                    "{amount}",
                    `${display.approxPrefix}${display.amountText}`,
                  )
                  .replace("{unit}", display.unitLabel),
            { direction: "in", amountSat: amount > 0 ? amount : null },
          );
        }
        void maybeShowPwaNotification(
          t("mints"),
          display === null
            ? t("cashuAccepted")
            : `${display.approxPrefix}${display.amountText} ${display.unitLabel}`,
          "cashu_claim",
        );
      },
      onReceiveFailed: (detail) =>
        setStatus(`${t("cashuAcceptFailed")}: ${detail}`),
      onUnsaved: (token) =>
        pushToast(t("npubCashClaimUnsaved"), {
          action: { label: t("copy"), onClick: () => void copyText(token) },
        }),
    }),
    [
      copyText,
      formatDisplayedAmountParts,
      isMintDeleted,
      maybeShowPwaNotification,
      mintInfoByUrl,
      pushToast,
      refreshMintInfo,
      rememberCashuTokenKnown,
      routeKind,
      setStatus,
      showPaidOverlay,
      t,
      touchMintInfo,
    ],
  );

  const claimNpubCashOnce = React.useCallback(async () => {
    if (!networkEnabled || commands === null) return;
    await commands.claim({ fast: routeKind === "topupInvoice" }, claimEvents);
  }, [claimEvents, commands, networkEnabled, routeKind]);
  const claimLatestRef = useLatest(claimNpubCashOnce);

  React.useEffect(() => {
    // Leave edit mode unless the dedicated edit route is active.
    if (routeKind !== "profileEdit") setIsProfileEditing(false);
  }, [routeKind, setIsProfileEditing]);

  React.useEffect(() => {
    if (isNpubCashDisabled() || !networkEnabled) return;
    if (!currentNpub || !currentNsec) return;
    const controller = new AbortController();

    const loadInfo = async () => {
      if (npubCashInfoInFlightRef.current) return;
      if (
        npubCashInfoLoadedForNpubRef.current === currentNpub &&
        Date.now() - npubCashInfoLoadedAtMsRef.current < INFO_REFRESH_MS
      )
        return;
      npubCashInfoInFlightRef.current = true;
      try {
        const info = await fetchNpubCashInfo(currentNsec, controller.signal);
        if (info === null || controller.signal.aborted) return;
        const mintUrl = readInfoMintUrl(info);
        if (mintUrl) suggestDefaultMint(mintUrl);
        npubCashInfoLoadedForNpubRef.current = currentNpub;
        npubCashInfoLoadedAtMsRef.current = Date.now();
      } catch {
        // Unreachable npub.cash keeps the stored default mint.
      } finally {
        npubCashInfoInFlightRef.current = false;
      }
    };

    void loadInfo();
    void claimLatestRef.current();
    const intervalId = setInterval(
      () => void claimLatestRef.current(),
      CLAIM_POLL_MS,
    );
    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [
    claimLatestRef,
    currentNpub,
    currentNsec,
    networkEnabled,
    npubCashInfoInFlightRef,
    npubCashInfoLoadedAtMsRef,
    npubCashInfoLoadedForNpubRef,
    suggestDefaultMint,
  ]);

  React.useEffect(() => {
    // Poll faster while the topup invoice shows, to see it paid quickly.
    if (!networkEnabled || routeKind !== "topupInvoice") return;
    void claimNpubCashOnce();
    const intervalId = setInterval(
      () => void claimNpubCashOnce(),
      TOPUP_CLAIM_POLL_MS,
    );
    return () => clearInterval(intervalId);
  }, [claimNpubCashOnce, networkEnabled, routeKind]);
};

/** Makes `mintUrl` the default mint, at npub.cash first; moves no funds. */
export const useApplyDefaultMint = () => {
  const registry = React.useContext(RegistryContext);
  const currentNpub = useAtomValue(currentNpubAtom);
  const currentNsec = useAtomValue(currentNsecAtom);
  const { setDefaultMint } = useAtomSuspense(defaultMintCommandsAtom).value;
  const pushToast = usePushToast();
  const setStatus = useSetStatus();
  const { t } = useTranslation();
  return React.useCallback(
    async (mintUrl: string): Promise<boolean> => {
      const cleaned = normalizeMintUrl(mintUrl);
      if (!isUrl(cleaned)) {
        pushToast(t("mintUrlInvalid"));
        return false;
      }
      try {
        setStatus(t("mintUpdating"));
        await updateNpubCashMint({ currentNpub, currentNsec, mint: cleaned });
      } catch (error) {
        pushToast(
          String(error ?? "").includes("Missing nsec")
            ? t("profileMissingNpub")
            : t("mintUpdateFailed"),
        );
        setStatus(null);
        return false;
      }
      registry.set(npubCashSyncedMintAtom, cleaned);
      await setDefaultMint(cleaned);
      setStatus(t("mintSaved"));
      return true;
    },
    [
      currentNpub,
      currentNsec,
      pushToast,
      registry,
      setDefaultMint,
      setStatus,
      t,
    ],
  );
};
