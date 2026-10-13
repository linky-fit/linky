import { useAtomValue } from "@linky-fit/linkstr-react";
import { Stack, PageScroll, SafeAreaPad } from "@linky-fit/ui";
import React from "react";
import { AuthenticatedLayout } from "../components/AuthenticatedLayout";
import { CashuContactSendBanner } from "../components/CashuContactSendBanner";
import { InstallPwaBanner } from "../components/InstallPwaBanner";
import { PwaUpdateBanner } from "../components/PwaUpdateBanner";
import { HydrationScreen } from "../components/HydrationScreen";
import { MigratingDataScreen } from "../components/MigratingDataScreen";
import { SecretsUnavailableScreen } from "../components/SecretsUnavailableScreen";
import { SecretsWriteFailedScreen } from "../components/SecretsWriteFailedScreen";
import { ToastNotifications } from "../components/ToastNotifications";
import { UnauthenticatedLayout } from "../components/UnauthenticatedLayout";
import { reportAppLog } from "../devtools/inspector/appLog";
import { usePersistentInspectorLogStartup } from "../devtools/inspector/usePersistentInspectorLogStartup";
import { navigateTo } from "../hooks/useRouting";
import { useToasts } from "../hooks/useToasts";
import { useDisplayAmounts, useTranslation } from "./hooks/shell";
import {
  reportSecretsWriteDecision,
  useSecretsWriteFailure,
} from "./hooks/useSecretsWriteFailure";
import { useTokenContactSend } from "./hooks/wallet/useWalletTokens";
import { BeaconController } from "./BeaconController";
import { useLaneToShardMigration } from "./migrations/useLaneToShardMigration";
import { AppRouteContent } from "./routes/AppRouteContent";
import { platformAtom } from "./state/platform";
import { hydrationAtom } from "./state/session/hydration";
import { sessionAtom } from "./state/session/session";
import { useAppShellComposition } from "./useAppShellComposition";
import { useUnauthenticatedAppShellComposition } from "./useUnauthenticatedAppShellComposition";

/** Fills the viewport; index.css shrinks it above the keyboard while a chat is open. */
const AppFrame = ({ children }: { children: React.ReactNode }) => (
  <Stack
    data-app-frame
    gap="$none"
    backgroundColor="$background"
    $platform-native={{ flex: 1 }}
  >
    {children}
  </Stack>
);

/** Pins app-wide banners over the top edge as full-width strips, stacked when several show at once. */
const TopBanners = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaPad
    position="fixed"
    top="$none"
    left="$none"
    right="$none"
    zIndex="$overlay"
    gap="$none"
    pointerEvents="box-none"
    edge="top"
  >
    {children}
  </SafeAreaPad>
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
      <PageScroll
        width="100%"
        maxWidth="$appWidth"
        alignSelf="center"
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
      </PageScroll>
    </AppFrame>
  );
};

/** Holds the shell behind the hydration screen while a restored account's data arrives, or until the user leaves for the relay settings. */
const FirstHydrationGate = ({ children }: { children: React.ReactNode }) => {
  const hydration = useAtomValue(hydrationAtom);
  const [released, setReleased] = React.useState(false);
  const { t } = useTranslation();
  if (released || hydration._tag === "Hydrated") return children;
  return (
    <AppFrame>
      <HydrationScreen
        synced={hydration.synced}
        total={hydration.total}
        onOpenRelaySettings={() => {
          reportAppLog({
            tag: "session.hydrationScreenLeft",
            summary: `Left the hydration screen for the Evolu relays with ${hydration.synced} owners synced`,
            payload: { synced: hydration.synced, total: hydration.total },
          });
          setReleased(true);
          navigateTo({ route: "evoluServers" });
        }}
        t={t}
      />
    </AppFrame>
  );
};

/** Holds the authenticated shell back until the one-time lane migration ran. */
const MigratedAppShell = (props: AuthenticatedAppShellProps) => {
  const migrating = useLaneToShardMigration();
  if (migrating)
    return (
      <AppFrame>
        <MigratingDataScreen />
      </AppFrame>
    );
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

/** Covers either shell while new keys the secure store refused wait in memory; the shells' back handlers cancel it. */
const SecretsWriteFailureLayer = () => {
  const { failure, cancel } = useSecretsWriteFailure();
  const { t } = useTranslation();
  if (failure === null || cancel === null) return null;
  return (
    <SecretsWriteFailedScreen
      backupWords={failure.backupWords}
      onRetry={() => {
        reportSecretsWriteDecision("retry");
        return failure.retry();
      }}
      onCancel={cancel}
      t={t}
    />
  );
};

const SessionShell = () => {
  const session = useAtomValue(sessionAtom);
  const { config } = useAtomValue(platformAtom);
  const [restoring, setRestoring] = React.useState(false);

  if (session._tag === "SecretsUnavailable")
    return restoring ? (
      <UnauthenticatedAppShell onLeaveRestore={() => setRestoring(false)} />
    ) : (
      <SecretsUnavailableAppShell onContinue={() => setRestoring(true)} />
    );
  if (session._tag !== "SignedIn") return <UnauthenticatedAppShell />;
  const shell = <MigratedAppShell currentNsec={session.secrets.nsec} />;
  // Outside the shell, which suspends until the store opens, so the screen shows before the shards sync.
  return config.blockOnFirstHydration ? (
    <FirstHydrationGate>{shell}</FirstHydrationGate>
  ) : (
    shell
  );
};

const AppShell = () => {
  usePersistentInspectorLogStartup();
  return (
    <>
      <SessionShell />
      <SecretsWriteFailureLayer />
    </>
  );
};

export default AppShell;
