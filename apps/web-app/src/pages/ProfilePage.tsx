import { nowSeconds } from "../utils/time";
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  QRCode,
  Row,
  Stack,
  Text,
  TextField,
  size,
  space,
  useMedia,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { ProfileAvatarEditor } from "../components/ProfileAvatarEditor";
import { parseProfileGeneralStatus } from "../nostrStatus";
import type { FilePickerHandle } from "../utils/pickFile";
import {
  formatShortLightningAddress,
  formatShortNpub,
} from "../utils/formatting";
import { buildOwnProfileShareUrl } from "../sharedProfileLink";
import { buildProfileShareUrl } from "../utils/profileShareUrl";
import {
  type Nip98AuthHeaderFactory,
  type OwnLightningAddressInputCandidate,
  type OwnLightningClaimAvailableResult,
  purchaseOwnLightningAddressClaim,
  requestOwnLightningAddressClaimPreview,
} from "../utils/npubCashUsernameClaim";
import { PageCard } from "../components/PageCard";

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
  shuffleProfileAvatar: () => void;
  derivedProfile: DerivedProfile | null;
  effectiveMyLightningAddress: string | null;
  effectiveProfileName: string | null;
  effectiveProfilePicture: string | null;
  isProfileEditing: boolean;
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
  profilePhotoInputRef: React.RefObject<FilePickerHandle | null>;
  profileSelectedPictureKind: "custom" | "generated";
  makeNip98AuthHeader: Nip98AuthHeaderFactory;
  payLightningInvoiceWithCashu: (invoice: string) => Promise<boolean>;
  saveClaimedLightningAddress: (lightningAddress: string) => Promise<boolean>;
  saveProfileEdits: () => Promise<void>;
  serverBaseUrl: string;
  setProfileEditLnAddress: (value: string) => void;
  setProfileEditName: (value: string) => void;
  setProfileEditStatus: (value: string) => void;
  shareText: (
    text: string,
    whenUnavailable?: () => Promise<void>,
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
  shuffleProfileAvatar,
  derivedProfile,
  effectiveMyLightningAddress,
  effectiveProfileName,
  effectiveProfilePicture,
  isProfileEditing,
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
  profilePhotoInputRef,
  profileSelectedPictureKind,
  makeNip98AuthHeader,
  payLightningInvoiceWithCashu,
  saveClaimedLightningAddress,
  saveProfileEdits,
  serverBaseUrl,
  setProfileEditLnAddress,
  setProfileEditName,
  setProfileEditStatus,
  shareText,
  writeCurrentNpubToNfc,
}: ProfilePageProps): React.ReactElement {
  const { formatDisplayedAmountParts, t } = useAppShellCore();
  const { wide } = useMedia();
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
    if (
      inlineClaimPreview.username !== unregisteredOwnLightningAddress?.username
    )
      return;
    if (inlineClaimInsufficientBalance) {
      setInlineClaimError(t("payInsufficient"));
      return;
    }
    if (inlineClaimPreview.invoice.expiresAtSec <= nowSeconds()) {
      setInlineClaimError(t("claimOwnLightningAddressInvoiceInvalid"));
      return;
    }

    setInlineClaimError(null);
    setInlineClaimIsConfirming(true);
    try {
      const result = await purchaseOwnLightningAddressClaim({
        availableBalanceSat: Math.max(cashuBalance, cashuBalanceAfterMelt),
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
    cashuBalance,
    cashuBalanceAfterMelt,
    inlineClaimInsufficientBalance,
    unregisteredOwnLightningAddress?.username,
    inlineClaimIsConfirming,
    inlineClaimPreview,
    makeNip98AuthHeader,
    payLightningInvoiceWithCashu,
    saveClaimedLightningAddress,
    serverBaseUrl,
    t,
  ]);

  if (!currentNpub) return <EmptyState title={t("profileMissingNpub")} />;

  if (!isProfileEditing) {
    const displayName = effectiveProfileName ?? formatShortNpub(currentNpub);
    const shareUrl = buildOwnProfileShareUrl(
      currentNpub,
      effectiveMyLightningAddress,
      ownedLightningAddresses,
    );
    return (
      <PageCard
        backgroundColor="$transparent"
        testID="profile-detail"
        alignItems="center"
        gap="$sm"
      >
        <Avatar
          name={displayName}
          uri={effectiveProfilePicture ?? undefined}
          size="lg"
        />
        <Text variant="display" textAlign="center">
          {displayName}
        </Text>
        <QRCode
          value={buildProfileShareUrl(currentNpub)}
          accessibilityLabel={t("copy")}
          tooltip={t("copy")}
          badge="Copy"
          onPress={() => void copyText(shareUrl)}
        />
        <Button
          variant="secondary"
          size="sm"
          icon="Share2"
          onPress={() => void shareText(shareUrl, () => copyText(shareUrl))}
        >
          {t("shareProfile")}
        </Button>
        {canWriteToNfc ? (
          <Button
            variant="secondary"
            size="sm"
            icon="Radio"
            onPress={() => void writeCurrentNpubToNfc()}
          >
            {t("uploadProfileToNfc")}
          </Button>
        ) : null}
        {effectiveMyLightningAddress ? (
          <Button
            variant="ghost"
            size="sm"
            icon="Copy"
            aria-label={t("lightningAddress")}
            onPress={() => void copyText(effectiveMyLightningAddress)}
          >
            {formatShortLightningAddress(effectiveMyLightningAddress)}
          </Button>
        ) : null}
        {profileStatusText ? (
          <Text color="$colorMuted" textAlign="center">
            {profileStatusText}
          </Text>
        ) : null}
      </PageCard>
    );
  }

  const showPurchaseButton =
    inlineClaimPreview !== null &&
    inlineClaimPreview.username === unregisteredOwnLightningAddress?.username;

  const saveButton = (
    <Button icon="Save" onPress={() => void saveProfileEdits()}>
      {t("saveChanges")}
    </Button>
  );
  const saveAction = wide ? (
    saveButton
  ) : (
    <Stack
      position="fixed"
      bottom="$none"
      left="$none"
      right="$none"
      backgroundColor="$background"
      zIndex="$sticky"
      data-safe-area="bottom"
    >
      <Stack paddingHorizontal="$xl" paddingVertical="$lg">
        {saveButton}
      </Stack>
    </Stack>
  );

  return (
    <PageCard
      backgroundColor="$transparent"
      marginBottom={
        !wide && canSaveProfileEdits ? size.control + space.lg * 2 : undefined
      }
    >
      <ProfileAvatarEditor
        currentNpub={currentNpub}
        shuffleProfileAvatar={shuffleProfileAvatar}
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

      <TextField
        id="profileName"
        label={t("name")}
        value={profileEditName}
        onChangeText={setProfileEditName}
        placeholder={t("name")}
      />

      <Stack gap="$xs">
        <Text variant="label" color="$colorSubtle">
          {t("lightningAddress")}
        </Text>
        <Row alignItems="flex-start" gap="$sm">
          <Stack flex={1}>
            <TextField
              id="profileLn"
              label={t("lightningAddress")}
              hideLabel
              value={profileEditLnAddress}
              onChangeText={setProfileEditLnAddress}
              placeholder={t("lightningAddress")}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              error={inlineClaimError ?? undefined}
              trailing={
                canRestoreDefaultLightningAddress && restoreLightningAddress ? (
                  <IconButton
                    icon="RefreshCcw"
                    size="sm"
                    accessibilityLabel={t("restore")}
                    onPress={() =>
                      setProfileEditLnAddress(restoreLightningAddress)
                    }
                  />
                ) : null
              }
            />
          </Stack>
          {showPurchaseButton ? (
            <Button
              loading={inlineClaimIsConfirming}
              disabled={
                cashuIsBusy ||
                inlineClaimInsufficientBalance ||
                inlineClaimIsChecking
              }
              tooltip={
                inlineClaimInsufficientBalance
                  ? t("payInsufficient")
                  : undefined
              }
              onPress={() => void purchaseInlineLightningAddress()}
            >
              {inlineClaimButtonLabel}
            </Button>
          ) : null}
        </Row>
      </Stack>

      <TextField
        id="profileStatus"
        label={t("status")}
        value={profileEditStatus}
        onChangeText={setProfileEditStatus}
        placeholder={t("status")}
      />

      {canSaveProfileEdits ? saveAction : null}
    </PageCard>
  );
}
