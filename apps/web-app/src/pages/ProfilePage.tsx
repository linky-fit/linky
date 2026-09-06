import { Copy, Radio, RefreshCcw, Save } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { Avatar } from "../components/Avatar";
import { ProfileAvatarEditor } from "../components/ProfileAvatarEditor";
import { ProfileQrButton } from "../components/ProfileQrButton";
import type { AvatarEditorControlId } from "../derivedProfile";
import {
  type ProfileStatusCurrency,
  parseProfileGeneralStatus,
} from "../nostrStatus";
import {
  formatShortLightningAddress,
  formatShortNpub,
  getInitials,
} from "../utils/formatting";
import {
  type Nip98AuthHeaderFactory,
  type OwnLightningAddressInputCandidate,
  type OwnLightningClaimAvailableResult,
  purchaseOwnLightningAddressClaim,
  requestOwnLightningAddressClaimPreview,
} from "../utils/npubCashUsernameClaim";

interface DerivedProfile {
  lnAddress: string;
  name: string;
  pictureUrl: string;
}

interface ProfilePageProps {
  cashuBalance: number;
  cashuBalanceAfterMelt: number;
  cashuIsBusy: boolean;
  canWriteToNfc: boolean;
  copyText: (text: string) => Promise<void>;
  currentNpub: string | null;
  cycleProfileAvatarControl: (controlId: AvatarEditorControlId) => void;
  derivedProfile: DerivedProfile | null;
  effectiveMyLightningAddress: string | null;
  effectiveProfileName: string | null;
  effectiveProfilePicture: string | null;
  isProfileEditing: boolean;
  myProfileQr: string | null;
  onPickProfilePhoto: () => Promise<void>;
  onProfilePhotoError: (error: unknown) => void;
  onProfilePhotoSelected: (dataUrl: string) => void;
  ownedLightningAddresses: readonly string[];
  profileCustomPictureUrl: string;
  profileEditLnAddress: string;
  profileEditName: string;
  profileEditPicture: string;
  profileEditStatus: string;
  profileEditsSavable: boolean;
  unregisteredOwnLightningAddress: OwnLightningAddressInputCandidate | null;
  profileStatus: string | null;
  profileStatusCurrencies: readonly ProfileStatusCurrency[];
  profileStatusIsSaving: boolean;
  profilePhotoInputRef: React.RefObject<HTMLInputElement | null>;
  profileSelectedPictureKind: "custom" | "generated";
  makeNip98AuthHeader: Nip98AuthHeaderFactory;
  payLightningInvoiceWithCashu: (invoice: string) => Promise<boolean>;
  saveClaimedLightningAddress: (lightningAddress: string) => Promise<boolean>;
  saveProfileEdits: () => Promise<void>;
  selectedProfileStatusCurrencies: readonly ProfileStatusCurrency[];
  serverBaseUrl: string;
  setProfileEditLnAddress: (value: string) => void;
  setProfileEditName: (value: string) => void;
  setProfileEditStatus: (value: string) => void;
  toggleProfileStatusCurrency: (
    currency: ProfileStatusCurrency,
  ) => Promise<void>;
  writeCurrentNpubToNfc: () => Promise<void>;
}

export function ProfilePage({
  cashuBalance,
  cashuBalanceAfterMelt,
  cashuIsBusy,
  canWriteToNfc,
  copyText,
  currentNpub,
  cycleProfileAvatarControl,
  derivedProfile,
  effectiveMyLightningAddress,
  effectiveProfileName,
  effectiveProfilePicture,
  isProfileEditing,
  myProfileQr,
  onPickProfilePhoto,
  onProfilePhotoError,
  onProfilePhotoSelected,
  ownedLightningAddresses,
  profileCustomPictureUrl,
  profileEditLnAddress,
  profileEditName,
  profileEditPicture,
  profileEditStatus,
  profileEditsSavable,
  unregisteredOwnLightningAddress,
  profileStatus,
  profileStatusCurrencies,
  profileStatusIsSaving,
  profilePhotoInputRef,
  profileSelectedPictureKind,
  makeNip98AuthHeader,
  payLightningInvoiceWithCashu,
  saveClaimedLightningAddress,
  saveProfileEdits,
  selectedProfileStatusCurrencies,
  serverBaseUrl,
  setProfileEditLnAddress,
  setProfileEditName,
  setProfileEditStatus,
  toggleProfileStatusCurrency,
  writeCurrentNpubToNfc,
}: ProfilePageProps): React.ReactElement {
  const { formatDisplayedAmountParts, t } = useAppShellCore();
  const [inlineClaimError, setInlineClaimError] = React.useState<string | null>(
    null,
  );
  const [inlineClaimIsChecking, setInlineClaimIsChecking] =
    React.useState(false);
  const [inlineClaimIsConfirming, setInlineClaimIsConfirming] =
    React.useState(false);
  const [inlineClaimPreview, setInlineClaimPreview] =
    React.useState<OwnLightningClaimAvailableResult | null>(null);
  const inlineClaimRequestSeqRef = React.useRef(0);
  const profileStatusText = parseProfileGeneralStatus(profileStatus).text;
  const restoreLightningAddress = React.useMemo(() => {
    for (const lightningAddress of ownedLightningAddresses) {
      const normalized = lightningAddress.trim().toLowerCase();
      if (normalized) return normalized;
    }

    return derivedProfile?.lnAddress ?? null;
  }, [derivedProfile?.lnAddress, ownedLightningAddresses]);
  const canRestoreDefaultLightningAddress =
    Boolean(restoreLightningAddress) &&
    profileEditLnAddress.trim().toLowerCase() !== restoreLightningAddress;
  const canCheckInlineClaim =
    isProfileEditing &&
    Boolean(unregisteredOwnLightningAddress) &&
    !unregisteredOwnLightningAddress?.issue;
  const inlineClaimQuotedAmount = inlineClaimPreview?.invoice.amountSat ?? null;
  const inlineClaimInsufficientBalance =
    inlineClaimQuotedAmount !== null &&
    Number.isFinite(inlineClaimQuotedAmount) &&
    inlineClaimQuotedAmount > Math.max(cashuBalance, cashuBalanceAfterMelt);
  const inlineClaimButtonLabel =
    inlineClaimQuotedAmount === null
      ? t("claimOwnLightningAddressPurchase")
      : (() => {
          const displayAmount = formatDisplayedAmountParts(
            inlineClaimQuotedAmount,
          );
          return t("claimOwnLightningAddressPurchaseFor").replace(
            "{amount}",
            `${displayAmount.approxPrefix}${displayAmount.amountText} ${displayAmount.unitLabel}`,
          );
        })();
  const canSaveProfileEdits =
    profileEditsSavable && !unregisteredOwnLightningAddress;

  React.useEffect(() => {
    const requestSeq = inlineClaimRequestSeqRef.current + 1;
    inlineClaimRequestSeqRef.current = requestSeq;

    setInlineClaimError(null);
    setInlineClaimPreview(null);
    setInlineClaimIsChecking(false);

    if (!canCheckInlineClaim || !unregisteredOwnLightningAddress) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setInlineClaimIsChecking(true);
      void requestOwnLightningAddressClaimPreview({
        makeNip98AuthHeader,
        serverBaseUrl,
        signal: controller.signal,
        username: unregisteredOwnLightningAddress.username,
      })
        .then((result) => {
          if (requestSeq !== inlineClaimRequestSeqRef.current) return;
          if (result.kind === "available") {
            setInlineClaimPreview(result);
            return;
          }
          if (result.kind === "taken") {
            setInlineClaimError(t("claimOwnLightningAddressTaken"));
            return;
          }
          if (result.kind === "already_set") {
            setInlineClaimError(t("claimOwnLightningAddressAlreadySet"));
            return;
          }
          if (result.kind === "error") {
            setInlineClaimError(
              result.message ?? t("claimOwnLightningAddressCheckFailed"),
            );
          }
        })
        .finally(() => {
          if (requestSeq !== inlineClaimRequestSeqRef.current) return;
          setInlineClaimIsChecking(false);
        });
    }, 1_000);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [
    canCheckInlineClaim,
    makeNip98AuthHeader,
    serverBaseUrl,
    t,
    unregisteredOwnLightningAddress,
  ]);

  const purchaseInlineLightningAddress = React.useCallback(async () => {
    if (!inlineClaimPreview) return;
    if (cashuIsBusy || inlineClaimIsConfirming) return;

    setInlineClaimError(null);
    setInlineClaimIsConfirming(true);
    try {
      const result = await purchaseOwnLightningAddressClaim({
        makeNip98AuthHeader,
        payLightningInvoiceWithCashu,
        preview: inlineClaimPreview,
        saveClaimedLightningAddress,
        serverBaseUrl,
      });
      if (result.kind === "cancelled") return;
      if (result.kind === "error") {
        setInlineClaimError(
          result.message === "Invoice unpaid..."
            ? t("claimOwnLightningAddressUnpaid")
            : result.message,
        );
      }
    } finally {
      setInlineClaimIsConfirming(false);
    }
  }, [
    cashuIsBusy,
    inlineClaimIsConfirming,
    inlineClaimPreview,
    makeNip98AuthHeader,
    payLightningInvoiceWithCashu,
    saveClaimedLightningAddress,
    serverBaseUrl,
    t,
  ]);

  return (
    <section className="panel">
      {!currentNpub ? (
        <p className="muted">{t("profileMissingNpub")}</p>
      ) : (
        <>
          {isProfileEditing ? (
            <>
              <ProfileAvatarEditor
                currentNpub={currentNpub}
                cycleProfileAvatarControl={cycleProfileAvatarControl}
                effectiveProfileName={effectiveProfileName}
                effectiveProfilePicture={effectiveProfilePicture}
                onPickProfilePhoto={onPickProfilePhoto}
                onProfilePhotoError={onProfilePhotoError}
                onProfilePhotoSelected={onProfilePhotoSelected}
                profileCustomPictureUrl={profileCustomPictureUrl}
                profileEditName={profileEditName}
                profileEditPicture={profileEditPicture}
                profilePhotoInputRef={profilePhotoInputRef}
                profileSelectedPictureKind={profileSelectedPictureKind}
                t={t}
              />

              <div className="form-field-heading">
                <label htmlFor="profileName">{t("name")}</label>
              </div>
              <input
                id="profileName"
                value={profileEditName}
                onChange={(e) => setProfileEditName(e.target.value)}
                placeholder={t("name")}
              />

              <div className="form-field-heading">
                <label htmlFor="profileLn">{t("lightningAddress")}</label>
                <div className="profile-field-label">
                  {canRestoreDefaultLightningAddress &&
                  restoreLightningAddress ? (
                    <button
                      type="button"
                      className="icon-only-ghost"
                      onClick={() =>
                        setProfileEditLnAddress(restoreLightningAddress)
                      }
                      title={t("restore")}
                      aria-label={t("restore")}
                    >
                      <RefreshCcw size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="profile-lightning-input-row">
                <input
                  id="profileLn"
                  value={profileEditLnAddress}
                  onChange={(e) => setProfileEditLnAddress(e.target.value)}
                  placeholder={t("lightningAddress")}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {inlineClaimPreview ? (
                  <button
                    type="button"
                    className="profile-lightning-purchase-button"
                    disabled={
                      cashuIsBusy ||
                      inlineClaimInsufficientBalance ||
                      inlineClaimIsChecking ||
                      inlineClaimIsConfirming
                    }
                    onClick={() => {
                      void purchaseInlineLightningAddress();
                    }}
                    title={
                      inlineClaimInsufficientBalance
                        ? t("payInsufficient")
                        : undefined
                    }
                  >
                    <span className="btn-label-with-icon">
                      {inlineClaimIsConfirming ? (
                        <span className="btn-spinner" aria-hidden="true" />
                      ) : null}
                      <span>
                        {inlineClaimIsConfirming
                          ? t("claimOwnLightningAddressPurchasing")
                          : inlineClaimButtonLabel}
                      </span>
                    </span>
                  </button>
                ) : null}
              </div>
              {inlineClaimError ? (
                <p className="muted section-note">{inlineClaimError}</p>
              ) : null}

              <div className="form-field-heading">
                <label htmlFor="profileStatus">{t("status")}</label>
              </div>
              <input
                id="profileStatus"
                value={profileEditStatus}
                onChange={(e) => setProfileEditStatus(e.target.value)}
                placeholder={t("status")}
              />

              <div className="panel-header panel-header-layout">
                {canSaveProfileEdits ? (
                  <button onClick={() => void saveProfileEdits()}>
                    <span className="btn-label-with-icon">
                      <span className="btn-label-icon" aria-hidden="true">
                        <Save size={18} />
                      </span>
                      <span>{t("saveChanges")}</span>
                    </span>
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="profile-detail">
                <div className="contact-avatar is-xl" aria-hidden="true">
                  <Avatar
                    pictureUrl={effectiveProfilePicture}
                    fallback={getInitials(
                      effectiveProfileName ?? formatShortNpub(currentNpub),
                    )}
                    fallbackClassName="contact-avatar-fallback"
                    loading="lazy"
                  />
                </div>

                <h2 className="contact-detail-name">
                  {effectiveProfileName ?? formatShortNpub(currentNpub)}
                </h2>

                {myProfileQr ? (
                  <ProfileQrButton
                    qrSrc={myProfileQr}
                    qrAlt={t("myNpubQr")}
                    copyLabel={t("copy")}
                    onCopy={() => {
                      if (!currentNpub) return;
                      void copyText(currentNpub);
                    }}
                  />
                ) : (
                  <p className="muted">{currentNpub}</p>
                )}

                {canWriteToNfc ? (
                  <button
                    type="button"
                    className="secondary btn-small profile-nfc-write-button"
                    onClick={() => void writeCurrentNpubToNfc()}
                    aria-label={t("uploadProfileToNfc")}
                    title={t("uploadProfileToNfc")}
                    disabled={!currentNpub}
                  >
                    <span className="btn-label-with-icon">
                      <span className="btn-label-icon" aria-hidden="true">
                        <Radio size={16} />
                      </span>
                      <span>{t("uploadProfileToNfc")}</span>
                    </span>
                  </button>
                ) : null}

                {effectiveMyLightningAddress ? (
                  <button
                    type="button"
                    className="copyable contact-detail-ln contact-detail-copy"
                    onClick={() => void copyText(effectiveMyLightningAddress)}
                    title={effectiveMyLightningAddress}
                    aria-label={t("lightningAddress")}
                  >
                    <span aria-hidden="true">⚡️</span>
                    <span className="contact-detail-copyText">
                      {formatShortLightningAddress(effectiveMyLightningAddress)}
                    </span>
                    <span
                      className="contact-detail-copyIcon"
                      aria-hidden="true"
                    >
                      <Copy size={16} />
                    </span>
                  </button>
                ) : null}

                {profileStatusText ? (
                  <p className="muted section-note">{profileStatusText}</p>
                ) : null}
              </div>
            </>
          )}

          <div className="profile-status-row">
            <div className="profile-status-label">
              {t("profileExchangeStatusLabel")}
            </div>
            <div className="profile-status-buttons">
              {profileStatusCurrencies.map((currency) => {
                const isActive =
                  selectedProfileStatusCurrencies.includes(currency);

                return (
                  <button
                    key={currency}
                    type="button"
                    className={
                      isActive
                        ? "profile-status-chip"
                        : "secondary profile-status-chip"
                    }
                    aria-pressed={isActive}
                    disabled={!currentNpub || profileStatusIsSaving}
                    onClick={() => {
                      void toggleProfileStatusCurrency(currency);
                    }}
                  >
                    {currency}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
