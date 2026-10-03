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
import {
  AppShellContextsProvider,
  type AppShellActionsContextValue,
  type AppShellCoreContextValue,
  type AppShellRouteContextValue,
} from "./context/AppShellContexts";
import { RecurringPaymentsProvider } from "./context/RecurringPaymentsContext";
import { SupporterProvider } from "./context/SupporterContext";
import { useCurrentNsec } from "./hooks/useCurrentNsec";
import { useSupporterThemeUnlock } from "./hooks/useOwnSupporterPerks";
import { useLaneToShardMigration } from "./migrations/useLaneToShardMigration";
import { AppRouteContent } from "./routes/AppRouteContent";
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
  setCurrentNsec: (currentNsec: string | null) => void;
}

const AuthenticatedAppShell = ({
  currentNsec,
  setCurrentNsec,
}: AuthenticatedAppShellProps) => {
  const {
    advancedSettingsContext,
    appActions,
    appState,
    cancelPendingCashuContactSend,
    dismissToast,
    evoluSettingsContext,
    formatDisplayedAmountText,
    mainSwipeRouteProps,
    mintSettingsContext,
    moneyRouteProps,
    peopleRouteProps,
    pendingCashuContactSend,
    recurringPaymentsContext,
    relaySettingsContext,
    supporterContext,
    t,
    toasts,
  } = useAppShellComposition({ currentNsec, setCurrentNsec });
  useSupporterThemeUnlock();

  const coreContextValue: AppShellCoreContextValue = appState;

  const actionsContextValue: AppShellActionsContextValue = appActions;

  const routeContextValue = React.useMemo<AppShellRouteContextValue>(
    () => ({
      mainSwipeRoutes: mainSwipeRouteProps,
      moneyRoutes: moneyRouteProps,
      peopleRoutes: peopleRouteProps,
    }),
    [mainSwipeRouteProps, moneyRouteProps, peopleRouteProps],
  );

  return (
    <AppFrame>
      <TopBanners>
        <PwaUpdateBanner t={t} />
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
      </TopBanners>
      <ToastNotifications toasts={toasts} dismissToast={dismissToast} />
      <InstallPwaBanner t={t} />

      <AppShellContextsProvider
        actions={actionsContextValue}
        advancedSettings={advancedSettingsContext}
        core={coreContextValue}
        evoluSettings={evoluSettingsContext}
        mintSettings={mintSettingsContext}
        relaySettings={relaySettingsContext}
        routes={routeContextValue}
      >
        <RecurringPaymentsProvider value={recurringPaymentsContext}>
          <SupporterProvider value={supporterContext}>
            <AuthenticatedLayout>
              <AppRouteContent />
            </AuthenticatedLayout>
          </SupporterProvider>
        </RecurringPaymentsProvider>
      </AppShellContextsProvider>
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
    pasteReturningSlip39FromClipboard,
    pickPendingOnboardingPhoto,
    savePendingOnboardingBackupToPasswordManager,
    selectReturningSlip39Suggestion,
    setLang,
    setOnboardingStep,
    setPendingOnboardingName,
    setReturningSlip39Input,
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
          pasteReturningSlip39FromClipboard={pasteReturningSlip39FromClipboard}
          pickPendingOnboardingPhoto={pickPendingOnboardingPhoto}
          selectReturningSlip39Suggestion={selectReturningSlip39Suggestion}
          savePendingOnboardingBackupToPasswordManager={
            savePendingOnboardingBackupToPasswordManager
          }
          setReturningSlip39Input={setReturningSlip39Input}
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
  const { currentNsec, isResolved, setCurrentNsec } = useCurrentNsec();
  usePersistentInspectorLogStartup();

  if (!isResolved) return null;
  if (!currentNsec) return <UnauthenticatedAppShell />;

  return (
    <MigratedAppShell
      currentNsec={currentNsec}
      setCurrentNsec={setCurrentNsec}
    />
  );
};

export default AppShell;
