import webAppEslintConfig, {
  platformSeamPlugin,
  platformSeamRules,
  restrictedSyntax,
  testHelperImportPatterns,
  testHelperImportIgnores,
  uiOnlyPlugin,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const storageMessage =
  "Browser storage goes through utils/storage.ts (safeLocalStorage* / safeSessionStorage* helpers).";
const navigateMessage = "Navigate with navigateTo() from hooks/useRouting.ts.";
const evoluMessage =
  "App code never calls the Evolu instance; read and write through the @linky-fit/linksync repositories (app/hooks/useLinksync.ts).";

const storageSyntax = [
  {
    selector:
      "MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(localStorage|sessionStorage)$/]",
    message: storageMessage,
  },
];
const onLocation = (path) =>
  `:matches([${path}.object.name='location'], [${path}.object.property.name='location'])`;
const navigationSyntax = [
  {
    selector: `CallExpression[callee.property.name=/^(assign|replace)$/]${onLocation("callee")}`,
    message: navigateMessage,
  },
  {
    selector: `AssignmentExpression[left.property.name=/^(hash|href)$/]${onLocation("left")}`,
    message: navigateMessage,
  },
];

const backSyntax = [
  {
    selector:
      "CallExpression[callee.property.name=/^(back|go)$/]:matches([callee.object.name='history'], [callee.object.object.name='window'][callee.object.property.name='history'])",
    message:
      "Back is resolveBackAction() (hooks/useRouting.ts / topbar) because hash navigation only grows history and a cold-start deep link has nothing to return to.",
  },
];
const evoluImportPatterns = [
  {
    group: ["@evolu/*"],
    message:
      "Take Evolu re-exports from @linky-fit/linksync; only src/evolu.ts, src/evoluDb.worker.ts and src/app/migrations import @evolu/* directly.",
  },
];
const wipeImportPatterns = [
  {
    group: ["**/evolu", "**/evolu.ts"],
    importNames: ["wipeEvoluStorage"],
    message:
      "The WASM-OOM recovery is the only automatic wipe; local data is otherwise cleared only by the user.",
  },
];

const platformSeamMessage =
  "Browser APIs go behind the platform seam in src/platform (or a .web.ts sibling), so native builds can supply their own implementation.";

/** Files that predate the platform seam rule; move their browser access into src/platform and delete the line. */
export const platformSeamRatchet = [
  "src/ErrorBoundary.tsx",
  "src/app/BeaconController.tsx",
  "src/app/hooks/cashu/useDeferredReceiveRetry.ts",
  "src/app/hooks/cashu/useTokenQr.ts",
  "src/app/hooks/composition/useCashuWalletComposition.ts",
  "src/app/hooks/composition/useScanNativeComposition.ts",
  "src/app/hooks/composition/useSystemSettingsComposition.ts",
  "src/app/hooks/contacts/useSharedProfileLink.ts",
  "src/app/hooks/guide/useContactsGuide.ts",
  "src/app/hooks/guide/useContactsOnboardingProgress.ts",
  "src/app/hooks/layout/useNativeBackHandler.ts",
  "src/app/hooks/messages/inboxNotifications.ts",
  "src/app/hooks/messages/useEditChatMessage.ts",
  "src/app/hooks/messages/useSendChatMessage.ts",
  "src/app/hooks/messages/useSendReaction.ts",
  "src/app/hooks/mint/useMintInfoStore.ts",
  "src/app/hooks/payments/useNowSeconds.ts",
  "src/app/hooks/payments/usePayContactWithCashuMessage.ts",
  "src/app/hooks/payments/useRecurringPaymentsActions.ts",
  "src/app/hooks/payments/useRecurringPaymentsScheduler.ts",
  "src/app/hooks/payments/useRecurringReminderSync.ts",
  "src/app/hooks/topup/useTopupFlow.ts",
  "src/app/hooks/useAnonymousPaymentTelemetry.ts",
  "src/app/hooks/useAppLanguage.ts",
  "src/app/hooks/useBankPaymentOffers.ts",
  "src/app/hooks/useFiatRates.ts",
  "src/app/hooks/useGuideScannerDomain.ts",
  "src/app/hooks/useKeryxMedia.ts",
  "src/app/hooks/useLnurlAuth.ts",
  "src/app/hooks/useMessagesDomain.ts",
  "src/app/hooks/usePaidOverlayState.ts",
  "src/app/hooks/usePaymentsDomain.ts",
  "src/app/hooks/useProfileAuthDomain.ts",
  "src/app/hooks/useProfileNpubCashEffects.ts",
  "src/app/hooks/usePushNotificationsSetting.ts",
  "src/app/hooks/usePushRegistrationLifecycle.ts",
  "src/app/hooks/useRecommendedRelays.ts",
  "src/app/hooks/useRelayDomain.ts",
  "src/app/hooks/useResumeOnLaunchAndOnline.ts",
  "src/app/hooks/useSiteLogin.ts",
  "src/app/hooks/useStoragePersistRequestEffect.ts",
  "src/app/hooks/useTopDownTilt.ts",
  "src/app/lib/bankPaymentOfferStorage.ts",
  "src/app/lib/beaconStore.ts",
  "src/app/lib/keryxCacheStorage.ts",
  "src/app/lib/keryxHtml.ts",
  "src/app/lib/messageEditorDom.ts",
  "src/app/lib/notificationOpenTarget.ts",
  "src/app/lib/pdfPreview.ts",
  "src/app/lib/pendingPayments.ts",
  "src/app/lib/privateImageFile.ts",
  "src/app/lib/privateImageMessage.ts",
  "src/app/lib/pwaNotifications.ts",
  "src/app/lib/testMintGate.ts",
  "src/app/routes/AppRouteContent.tsx",
  "src/app/routes/MainTabPanes.tsx",
  "src/app/useAppShellComposition.tsx",
  "src/components/ChatMessage.tsx",
  "src/components/ChatMessageEditor.tsx",
  "src/components/InstallPwaBanner.tsx",
  "src/components/LightningInvoiceConfirmModal.tsx",
  "src/components/ProfileShareOverlay.tsx",
  "src/components/ProfileShareSheet.tsx",
  "src/components/SelfieCaptureModal.tsx",
  "src/evolu.ts",
  "src/evoluDb.worker.ts",
  "src/hooks/useArmedAction.ts",
  "src/hooks/useDeferredOnlineReady.ts",
  "src/hooks/useDesktopSplitView.ts",
  "src/hooks/useDocumentVisible.ts",
  "src/hooks/useOnline.ts",
  "src/hooks/useRouting.ts",
  "src/hooks/useToasts.ts",
  "src/lnurlAuth.ts",
  "src/lnurlPay.ts",
  "src/pages/AdvancedPage.tsx",
  "src/pages/BankPaymentOfferDetailPage.tsx",
  "src/pages/CashuTokenPage.tsx",
  "src/pages/CashuTokensPage.tsx",
  "src/pages/ChatPage.tsx",
  "src/pages/ContactNewPage.tsx",
  "src/pages/EvoluReloadNotice.tsx",
  "src/pages/ProfilePage.tsx",
  "src/pages/PushDebugPage.tsx",
  "src/pages/RecurringPaymentFormPage.tsx",
  "src/profileCache.ts",
  "src/sharedProfileLink.ts",
  "src/siteLogin.ts",
  "src/types/route.ts",
  "src/utils/blossomUploadProxy.ts",
  "src/utils/bootDiagnostics.ts",
  "src/utils/browserPreferences.ts",
  "src/utils/colorMode.ts",
  "src/utils/formatting.ts",
  "src/utils/image.ts",
  "src/utils/mint.ts",
  "src/utils/nostrRelays.ts",
  "src/utils/npubCashServer.ts",
  "src/utils/pickFile.ts",
  "src/utils/pushContactNamesStorage.ts",
  "src/utils/pushNotifications.ts",
  "src/utils/pushNsecStorage.ts",
  "src/utils/pwaUpdate.ts",
  "src/utils/recurringReminderNotes.ts",
  "src/utils/spdPayment.ts",
  "src/utils/storage.ts",
];

export default defineConfig([
  ...webAppEslintConfig,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: testHelperImportIgnores,
    rules: {
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...testHelperImportPatterns,
            ...evoluImportPatterns,
            ...wipeImportPatterns,
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: storageMessage },
        { name: "sessionStorage", message: storageMessage },
      ],
      "no-restricted-properties": [
        "error",
        ...[
          "useQuery",
          "useOwner",
          "upsert",
          "insert",
          "update",
          "createQuery",
          "loadQuery",
          "subscribeQuery",
        ].map((property) => ({
          object: "evolu",
          property,
          message: evoluMessage,
        })),
      ],
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...storageSyntax,
        ...navigationSyntax,
      ],
    },
  },
  {
    files: ["src/evolu.ts", "src/evoluDb.worker.ts", "src/app/migrations/**"],
    ignores: testHelperImportIgnores,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...testHelperImportPatterns, ...wipeImportPatterns] },
      ],
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["src/app/useAppShellComposition.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [...testHelperImportPatterns, ...evoluImportPatterns] },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      ...testHelperImportIgnores,
      "src/platform/**",
      "src/**/*.web.{ts,tsx}",
      "src/sw.ts",
      "src/main.tsx",
      "src/devtools/**",
      ...platformSeamRatchet,
    ],
    plugins: { "platform-seam": platformSeamPlugin },
    rules: platformSeamRules(platformSeamMessage),
  },
  {
    files: ["src/**/*.tsx"],
    ignores: testHelperImportIgnores,
    plugins: { "linky-ui": uiOnlyPlugin },
    rules: { "linky-ui/ui-only": ["error", { allow: ["video"] }] },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "waitForTimeout",
          message:
            "Wait on observable state with expect, expect.poll or toPass; the writing-tests skill covers the exception.",
        },
      ],
    },
  },
  {
    files: ["src/devtools/e2e/**"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: [
      "src/utils/storage.ts",
      "src/platform/linkshu/localStorageKeyValueStore.ts",
      "src/app/migrations/linkshuStorageMigration.ts",
      "src/app/hooks/useLinkstrConfigSync.ts",
    ],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...navigationSyntax,
      ],
    },
  },
  {
    files: ["src/hooks/useRouting.ts", "src/utils/spdPayment.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...storageSyntax,
      ],
    },
  },
]);
