import { useAtomValue } from "@linky-fit/linkstr-react";
import { Stack } from "@linky-fit/ui";
import React from "react";
import { AuthenticatedLayout } from "../components/AuthenticatedLayout";
import { CashuContactSendBanner } from "../components/CashuContactSendBanner";
import { InstallPwaBanner } from "../components/InstallPwaBanner";
import { PwaUpdateBanner } from "../components/PwaUpdateBanner";
import { MigratingDataScreen } from "../components/MigratingDataScreen";
import { ToastNotifications } from "../components/ToastNotifications";
import { UnauthenticatedLayout } from "../components/UnauthenticatedLayout";
import { usePersistentInspectorLogStartup } from "../devtools/inspector/usePersistentInspectorLogStartup";
import { useToasts } from "../hooks/useToasts";
import { useDisplayAmounts, useTranslation } from "./hooks/shell";
import { useTokenContactSend } from "./hooks/wallet/useWalletTokens";
import { BeaconController } from "./BeaconController";
import { useLaneToShardMigration } from "./migrations/useLaneToShardMigration";
import { AppRouteContent } from "./routes/AppRouteContent";
import { sessionAtom } from "./state/session/session";
import { useAppShellComposition } from "./useAppShellComposition";
import { useUnauthenticatedAppShellComposition } from "./useUnauthenticatedAppShellComposition";

/** Fills the viewport; index.css shrinks it above the keyboard while a chat is open. */
const AppFrame = ({ children }: { children: React.ReactNode }) => (
  <Stack data-app-frame gap="$none" backgroundColor="$background">
    {children}
  </Stack>
);

/** Pins app-wide banners over the top edge as full-width strips, stacked when several show at once. */
const TopBanners = ({ children }: { children: React.ReactNode }) => (
  <Stack
    position="fixed"
    top="$none"
    left="$none"
    right="$none"
    zIndex="$overlay"
    gap="$none"
    pointerEvents="box-none"
    data-safe-area="top"
  >
    {children}
  </Stack>
);

interface AuthenticatedAppShellProps {
  currentNsec: string;
}

/** Offers to cancel a token send while the user picks its contact. */
const ContactSendBanner = () => {
  const { t } = useTranslation();
  const { formatDisplayedAmountText } = useDisplayAmounts();
  const { cancelPendingCashuContactSend, pendingCashuContactSend } =
    useTokenContactSend();
  return (
    <CashuContactSendBanner
      amountText={
        pendingCashuContactSend
          ? formatDisplayedAmountText(pendingCashuContactSend.amountSat)
          : null
      }
      onCancel={() => {
        void cancelPendingCashuContactSend();
      }}
      t={t}
    />
  );
};

const AuthenticatedAppShell = ({ currentNsec }: AuthenticatedAppShellProps) => {
  useAppShellComposition({ currentNsec });
  const { t } = useTranslation();
  const { dismissToast, toasts } = useToasts();

  return (
    <AppFrame>
      <TopBanners>
        <PwaUpdateBanner t={t} />
        <ContactSendBanner />
      </TopBanners>
      <ToastNotifications toasts={toasts} dismissToast={dismissToast} />
      <InstallPwaBanner t={t} />
      <BeaconController currentNsec={currentNsec} />

      <AuthenticatedLayout>
        <AppRouteContent />
      </AuthenticatedLayout>
    </AppFrame>
  );
};

const UnauthenticatedAppShell = () => {
  const {
    confirmPendingOnboardingProfile,
    createNewAccount,
    shufflePendingOnboardingAvatar,
    dismissToast,
    lang,
    onboardingIsBusy,
    onboardingPhotoInputRef,
    onboardingStep,
    openReturningOnboarding,
    onPendingOnboardingPhotoError,
    onPendingOnboardingPhotoSelected,
    pasteReturningSlip39,
    pasteReturningSlip39FromClipboard,
    pickPendingOnboardingPhoto,
    savePendingOnboardingBackupToPasswordManager,
    setLang,
    setOnboardingStep,
    setPendingOnboardingName,
    setReturningSlip39Words,
    submitReturningSlip39,
    t,
    toasts,
  } = useUnauthenticatedAppShellComposition();

  return (
    <AppFrame>
      <TopBanners>
        <PwaUpdateBanner t={t} />
      </TopBanners>
      <ToastNotifications toasts={toasts} dismissToast={dismissToast} />
      <InstallPwaBanner t={t} />
      <Stack
        flex={1}
        minHeight={0}
        width="100%"
        maxWidth="$appWidth"
        alignSelf="center"
        overflowY="auto"
        paddingHorizontal="$xl"
      >
        <UnauthenticatedLayout
          confirmPendingOnboardingProfile={confirmPendingOnboardingProfile}
          onboardingStep={onboardingStep}
          onboardingIsBusy={onboardingIsBusy}
          lang={lang}
          onboardingPhotoInputRef={onboardingPhotoInputRef}
          openReturningOnboarding={openReturningOnboarding}
          onPendingOnboardingPhotoError={onPendingOnboardingPhotoError}
          onPendingOnboardingPhotoSelected={onPendingOnboardingPhotoSelected}
          setOnboardingStep={setOnboardingStep}
          createNewAccount={createNewAccount}
          shufflePendingOnboardingAvatar={shufflePendingOnboardingAvatar}
          pasteReturningSlip39={pasteReturningSlip39}
          pasteReturningSlip39FromClipboard={pasteReturningSlip39FromClipboard}
          pickPendingOnboardingPhoto={pickPendingOnboardingPhoto}
          savePendingOnboardingBackupToPasswordManager={
            savePendingOnboardingBackupToPasswordManager
          }
          setReturningSlip39Words={setReturningSlip39Words}
          setLang={setLang}
          setPendingOnboardingName={setPendingOnboardingName}
          submitReturningSlip39={submitReturningSlip39}
          t={t}
        />
      </Stack>
    </AppFrame>
  );
};

/** Holds the authenticated shell back until the one-time lane migration ran. */
const MigratedAppShell = (props: AuthenticatedAppShellProps) => {
  const migrating = useLaneToShardMigration();
  if (migrating) return <MigratingDataScreen />;
  return <AuthenticatedAppShell {...props} />;
};

const AppShell = () => {
  const session = useAtomValue(sessionAtom);
  usePersistentInspectorLogStartup();

  if (session._tag !== "SignedIn") return <UnauthenticatedAppShell />;
  return <MigratedAppShell currentNsec={session.secrets.nsec} />;
};

export default AppShell;
