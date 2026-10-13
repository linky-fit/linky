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
  SafeAreaPad,
} from "@linky-fit/ui";
import React from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import {
  useCopyText,
  useDisplayAmounts,
  useTranslation,
} from "../app/hooks/shell";
import { useEffectiveProfile } from "../app/hooks/profile/useEffectiveProfile";
import { useProfileEditor } from "../app/hooks/profile/useProfileEditor";
import { useWalletBalance } from "../app/hooks/wallet/useWalletInventory";
import { useNpubCashAuthHeader } from "../app/hooks/wallet/useNpubCash";
import {
  myProfileAtom,
  ownedLightningAddressesAtom,
} from "../app/state/contacts/profiles";
import { currentNpubAtom } from "../app/state/session/session";
import { NPUB_CASH_SERVER_BASE_URL } from "../utils/npubCashServer";
import { ProfileAvatarEditor } from "../components/ProfileAvatarEditor";
import { ProfileShareSheet } from "../components/ProfileShareSheet";
import { OwnLightningAddressClaimedModal } from "../components/OwnLightningAddressClaimedModal";
import { parseProfileGeneralStatus } from "../nostrStatus";
import type { FilePickerHandle } from "../utils/pickFile";
import {
  formatShortLightningAddress,
  formatShortNpub,
} from "../utils/formatting";
import { buildOwnProfileShareUrl } from "../sharedProfileLink";
import {
  type Nip98AuthHeaderFactory,
  OWN_LIGHTNING_ADDRESS_DOMAIN,
  type OwnLightningAddressInputCandidate,
  type OwnLightningClaimAvailableResult,
  getOwnLightningAddressInputCandidate,
  purchaseOwnLightningAddressClaim,
  requestOwnLightningAddressClaimPreview,
} from "../utils/npubCashUsernameClaim";
import { PageCard } from "../components/PageCard";
import { canWriteNfc, useWriteCurrentNpubToNfc } from "../app/hooks/shell/nfc";
import { useShareText } from "../app/hooks/shell/share";
import { useWalletCommands } from "../app/hooks/wallet/useWalletCommands";

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
  profileIsSaving: boolean;
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
  shareText: (text: string) => Promise<void>;
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
  profileIsSaving,
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
  const { t } = useTranslation();
  const { formatDisplayedAmountParts } = useDisplayAmounts();
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
  const [shareSheetOpen, setShareSheetOpen] = React.useState(false);
  const [claimedLightningAddress, setClaimedLightningAddress] = React.useState<
    string | null
  >(null);
  const lnInputRef = React.useRef<HTMLInputElement | null>(null);
  // Own-address mode: the field holds just the username and shows the linky.fit domain as a suffix.
  const [ownAddressMode, setOwnAddressMode] = React.useState(false);
  const ownAddressSuffix = `@${OWN_LIGHTNING_ADDRESS_DOMAIN}`;
  const ownAddressUsername = profileEditLnAddress
    .toLowerCase()
    .endsWith(ownAddressSuffix)
    ? profileEditLnAddress.slice(0, -ownAddressSuffix.length)
    : profileEditLnAddress;
  // The default npub@linky.fit address parses as a candidate too, but with an invalid username.
  const ownAddressCandidate =
    getOwnLightningAddressInputCandidate(profileEditLnAddress);
  const isOwnAddressDraft =
    ownAddressCandidate !== null &&
    ownAddressCandidate.issue !== "invalid_format";
  const startOwnAddress = () => {
    setOwnAddressMode(true);
    setProfileEditLnAddress(isOwnAddressDraft ? ownAddressUsername : "");
    lnInputRef.current?.focus();
  };
  const changeLnAddress = (text: string) => {
    // Typing a domain leaves own-address mode, so any provider stays reachable.
    if (ownAddressMode && text.includes("@")) setOwnAddressMode(false);
    setProfileEditLnAddress(text);
  };
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
  // In own-address mode there is nothing to save until a username is bought.
  const canSaveProfileEdits =
    profileEditsSavable &&
    !unregisteredOwnLightningAddress &&
    !(ownAddressMode && !isOwnAddressDraft);

  React.useEffect(() => {
    const requestSeq = inlineClaimRequestSeqRef.current + 1;
    inlineClaimRequestSeqRef.current = requestSeq;

    setInlineClaimError(null);
    setInlineClaimPreview(null);
    setInlineClaimIsChecking(false);

    if (!canCheckInlineClaim || !unregisteredOwnLightningAddress) return;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
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
      clearTimeout(timeoutId);
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
      if (result.kind === "success") {
        setClaimedLightningAddress(inlineClaimPreview.lightningAddress);
        return;
      }
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

  const claimedModal = claimedLightningAddress ? (
    <OwnLightningAddressClaimedModal
      lightningAddress={claimedLightningAddress}
      onClose={() => setClaimedLightningAddress(null)}
    />
  ) : null;

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
        <Stack data-guide="profile-qr">
          <QRCode
            value={currentNpub}
            accessibilityLabel={t("copy")}
            tooltip={t("copy")}
            badge="Copy"
            onPress={() => void copyText(currentNpub)}
          />
        </Stack>
        <Button
          variant="secondary"
          size="sm"
          icon="Share2"
          onPress={() => setShareSheetOpen(true)}
        >
          {t("shareProfile")}
        </Button>
        {shareSheetOpen ? (
          <ProfileShareSheet
            npub={currentNpub}
            shareUrl={shareUrl}
            copyText={copyText}
            shareText={shareText}
            onClose={() => setShareSheetOpen(false)}
            t={t}
          />
        ) : null}
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
            icon="Zap"
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
        {claimedModal}
      </PageCard>
    );
  }

  const showPurchaseButton =
    inlineClaimPreview !== null &&
    inlineClaimPreview.username === unregisteredOwnLightningAddress?.username;
  const restoreButton =
    canRestoreDefaultLightningAddress && restoreLightningAddress ? (
      <IconButton
        icon="RefreshCcw"
        size="sm"
        accessibilityLabel={t("restore")}
        onPress={() => {
          setOwnAddressMode(false);
          setProfileEditLnAddress(restoreLightningAddress);
        }}
      />
    ) : null;

  const saveButton = (
    <Button
      icon="Save"
      loading={profileIsSaving}
      onPress={() => void saveProfileEdits()}
    >
      {t("saveChanges")}
    </Button>
  );
  const saveAction = wide ? (
    saveButton
  ) : (
    <SafeAreaPad
      position="fixed"
      bottom="$none"
      left="$none"
      right="$none"
      backgroundColor="$background"
      zIndex="$sticky"
      edge="bottom"
    >
      <Stack paddingHorizontal="$xl" paddingVertical="$lg">
        {saveButton}
      </Stack>
    </SafeAreaPad>
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

      <Stack gap="$xs" data-guide="profile-ln-address">
        <Text variant="label" color="$colorSubtle">
          {t("lightningAddress")}
        </Text>
        <Row alignItems="flex-start" gap="$sm">
          <Stack flex={1}>
            <TextField
              ref={(node) => {
                lnInputRef.current =
                  node instanceof HTMLInputElement ? node : null;
              }}
              id="profileLn"
              label={t("lightningAddress")}
              hideLabel
              value={ownAddressMode ? ownAddressUsername : profileEditLnAddress}
              onChangeText={changeLnAddress}
              placeholder={ownAddressMode ? t("name") : t("lightningAddress")}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              error={inlineClaimError ?? undefined}
              trailing={
                ownAddressMode ? (
                  <Row alignItems="center" gap="$xs">
                    <Text
                      variant="caption"
                      color="$colorMuted"
                      numberOfLines={1}
                      testID="profile-own-ln-address-suffix"
                    >
                      {ownAddressSuffix}
                    </Text>
                    {restoreButton}
                  </Row>
                ) : (
                  restoreButton
                )
              }
            />
          </Stack>
          {ownAddressMode || isOwnAddressDraft ? (
            <Button
              minHeight={size.field}
              loading={inlineClaimIsConfirming}
              disabled={
                !showPurchaseButton ||
                cashuIsBusy ||
                inlineClaimInsufficientBalance ||
                inlineClaimIsChecking
              }
              tooltip={
                inlineClaimInsufficientBalance
                  ? t("payInsufficient")
                  : undefined
              }
              testID="profile-own-ln-address-purchase"
              onPress={() => void purchaseInlineLightningAddress()}
            >
              {inlineClaimButtonLabel}
            </Button>
          ) : (
            <Button
              minHeight={size.field}
              variant="secondary"
              icon="Zap"
              testID="profile-own-ln-address"
              onPress={startOwnAddress}
            >
              {t("claimOwnLightningAddressStart")}
            </Button>
          )}
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
      {claimedModal}
    </PageCard>
  );
}

export function ProfileRoute(): React.ReactElement {
  const { payLightningInvoiceWithCashu } = useWalletCommands();
  const shareText = useShareText();
  const writeCurrentNpubToNfc = useWriteCurrentNpubToNfc();
  const { cashuBalance, cashuBalanceAfterMelt, cashuIsBusy } =
    useWalletBalance();
  const copyText = useCopyText();
  const currentNpub = useAtomValue(currentNpubAtom);
  const profile = useEffectiveProfile();
  const profileStatus = useAtomValue(myProfileAtom, (my) => my.status);
  const ownedLightningAddresses = useAtomValue(
    ownedLightningAddressesAtom,
    (owned) => owned.addresses,
  );
  const makeNip98AuthHeader = useNpubCashAuthHeader();
  const editor = useProfileEditor();
  return (
    <ProfilePage
      {...editor}
      canWriteToNfc={canWriteNfc()}
      cashuBalance={cashuBalance}
      cashuBalanceAfterMelt={cashuBalanceAfterMelt}
      cashuIsBusy={cashuIsBusy}
      copyText={copyText}
      currentNpub={currentNpub}
      derivedProfile={profile.derivedProfile}
      effectiveMyLightningAddress={profile.effectiveMyLightningAddress}
      effectiveProfileName={profile.effectiveProfileName}
      effectiveProfilePicture={profile.effectiveProfilePicture}
      makeNip98AuthHeader={makeNip98AuthHeader}
      ownedLightningAddresses={ownedLightningAddresses}
      payLightningInvoiceWithCashu={payLightningInvoiceWithCashu}
      profileStatus={profileStatus}
      serverBaseUrl={NPUB_CASH_SERVER_BASE_URL}
      shareText={shareText}
      writeCurrentNpubToNfc={writeCurrentNpubToNfc}
    />
  );
}
