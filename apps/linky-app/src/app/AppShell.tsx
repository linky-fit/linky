import { useAtomValue } from "@linky-fit/linkstr-react";
import { Stack } from "@linky-fit/ui";
import React from "react";
import { AuthenticatedLayout } from "../components/AuthenticatedLayout";
import { CashuContactSendBanner } from "../components/CashuContactSendBanner";
import { InstallPwaBanner } from "../components/InstallPwaBanner";
import { PwaUpdateBanner } from "../components/PwaUpdateBanner";
import { MigratingDataScreen } from "../components/MigratingDataScreen";
import { SecretsUnavailableScreen } from "../components/SecretsUnavailableScreen";
import { ToastNotifications } from "../components/ToastNotifications";
import { UnauthenticatedLayout } from "../components/UnauthenticatedLayout";
import { reportAppLog } from "../devtools/inspector/appLog";
import { usePersistentInspectorLogStartup } from "../devtools/inspector/usePersistentInspectorLogStartup";
import { useToasts } from "../hooks/useToasts";
import { useDisplayAmounts, useTranslation } from "./hooks/shell";
import { useTokenContactSend } from "./hooks/wallet/useWalletTokens";
import { BeaconController } from "./BeaconController";
import { useLaneToShardMigration } from "./migrations/useLaneToShardMigration";
import { AppRouteContent } from "./routes/AppRouteContent";
import { platformAtom } from "./state/platform";
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

const UnauthenticatedAppShell = ({
  onLeaveRestore,
}: {
  onLeaveRestore?: () => void;
}) => {
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
          onLeaveRestore={onLeaveRestore}
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

/** Retry reboots and reads the secure store again; Continue restores from backup words, never into an empty database. */
const SecretsUnavailableAppShell = ({
  onContinue,
}: {
  onContinue: () => void;
}) => {
  const { t } = useTranslation();
  const { lifecycle } = useAtomValue(platformAtom);
  const reportDecision = (decision: "continue" | "retry") =>
    reportAppLog({
      tag: "session.secretsUnavailableDecided",
      summary: `The user chose to ${decision} after the keys could not be read`,
      payload: { decision },
    });
  return (
    <AppFrame>
      <SecretsUnavailableScreen
        onContinue={() => {
          reportDecision("continue");
          onContinue();
        }}
        onRetry={() => {
          reportDecision("retry");
          lifecycle.reload();
        }}
        t={t}
      />
    </AppFrame>
  );
};

const AppShell = () => {
  const session = useAtomValue(sessionAtom);
  const [restoring, setRestoring] = React.useState(false);
  usePersistentInspectorLogStartup();

  if (session._tag === "SecretsUnavailable")
    return restoring ? (
      <UnauthenticatedAppShell onLeaveRestore={() => setRestoring(false)} />
    ) : (
      <SecretsUnavailableAppShell onContinue={() => setRestoring(true)} />
    );
  if (session._tag !== "SignedIn") return <UnauthenticatedAppShell />;
  return <MigratedAppShell currentNsec={session.secrets.nsec} />;
};

export default AppShell;
