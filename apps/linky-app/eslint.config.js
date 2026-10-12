import webAppEslintConfig, {
  platformSeamPlugin,
  platformSeamRules,
  pureJsPbkdf2ImportPatterns,
  restrictedSyntax,
  testHelperImportPatterns,
  testHelperImportIgnores,
  uiOnlyPlugin,
} from "@linky-fit/config/eslint";
import { defineConfig } from "eslint/config";

const storageMessage =
  "Browser storage goes through utils/storage.ts (safeLocalStorage* / safeSessionStorage* helpers).";
const navigateMessage =
  "Navigate with navigateTo() from hooks/useRouting.ts; only platform/navigation.ts touches the URL.";
const evoluMessage =
  "App code never calls the Evolu instance; read and write through the @linky-fit/linksync repositories (app/hooks/useLinksync.ts).";

const storageSyntax = [
  {
    selector:
      "MemberExpression[object.name=/^(window|globalThis)$/][property.name=/^(localStorage|sessionStorage)$/]",
    message: storageMessage,
  },
];
const envMessage = "Read build-time env from platform/buildEnv.ts.";
const envSyntax = [
  {
    selector:
      "MemberExpression[object.type='MetaProperty'][property.name='env']",
    message: envMessage,
  },
  // import.meta used other than as import.meta.<name>, e.g. import.meta["env"] or const { env } = import.meta.
  {
    selector:
      "MetaProperty[meta.name='import']:not(MemberExpression[computed=false] > MetaProperty.object)",
    message: envMessage,
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
const routeReadMessage =
  "Read the route with currentRoutePath() or useCurrentRoutePath() from platform/navigation.ts; inbound command links go through platform/hashLinks.ts.";
const routeReadSyntax = [
  {
    selector:
      "MemberExpression[property.name='hash']:matches([object.name='location'], [object.property.name='location'])",
    message: routeReadMessage,
  },
  { selector: "Literal[value='hashchange']", message: routeReadMessage },
];
/** Inbound command links (`#add/…`, `#nostrconnect…`, `#linkauth…`, `?cashu=`, `?notificationOpen=`) are read from the hash in one place. */
const commandLinkFiles = ["src/platform/hashLinks.ts"];

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
      "Take Evolu re-exports from @linky-fit/linksync; only src/evolu.ts, src/evoluDb.worker.ts, src/platform/evolu.web.ts and src/app/migrations import @evolu/* directly.",
  },
];
const wipeImportPatterns = [
  {
    group: ["**/evolu", "**/evolu.ts"],
    importNames: ["useWipeEvoluStorage"],
    message:
      "The WASM-OOM recovery is the only automatic wipe; local data is otherwise cleared only by the user.",
  },
];
const stateMessage =
  "src/app/state holds atoms and pure Effect code; React, translations, routing and toasts belong in the hooks in src/app/hooks.";
const stateImportPatterns = [
  {
    group: [
      "**/hooks/useRouting",
      "**/hooks/useToasts",
      "**/i18n",
      "**/i18n/**",
      "react-dom/*",
      "@effect/atom-react/*",
    ],
    message: stateMessage,
  },
];
const stateImportPaths = ["react", "react-dom", "@effect/atom-react"].map(
  (name) => ({ name, message: stateMessage }),
);

const platformSeamMessage =
  "Browser APIs go behind the platform seam in src/platform (or a .web.ts sibling), so native builds can supply their own implementation.";

/** Files that predate the platform seam rule; move their browser access into src/platform and delete the line. */
export const platformSeamRatchet = [
  "src/ErrorBoundary.tsx",
  "src/app/BeaconController.tsx",
  "src/app/hooks/cashu/useDeferredReceiveRetry.ts",
  "src/app/hooks/cashu/useTokenQr.ts",
  "src/app/hooks/composition/useScanNativeComposition.ts",
  "src/app/hooks/guide/useContactsGuide.ts",
  "src/app/hooks/guide/useContactsOnboardingProgress.ts",
  "src/app/hooks/layout/useNativeBackHandler.ts",
  "src/app/hooks/messages/inboxNotifications.ts",
  "src/app/hooks/messages/useEditChatMessage.ts",
  "src/app/hooks/messages/useSendChatMessage.ts",
  "src/app/hooks/messages/useSendReaction.ts",
  "src/app/hooks/payments/useNowSeconds.ts",
  "src/app/hooks/payments/useRecurringPaymentsScheduler.ts",
  "src/app/hooks/payments/useRecurringReminderSync.ts",
  "src/app/hooks/topup/useTopupFlow.ts",
  "src/app/hooks/useAnonymousPaymentTelemetry.ts",
  "src/app/hooks/useAppLanguage.ts",
  "src/app/hooks/useBankPaymentOffers.ts",
  "src/app/hooks/useGuideScannerDomain.ts",
  "src/app/hooks/useKeryxMedia.ts",
  "src/app/hooks/useLnurlAuth.ts",
  "src/app/hooks/useProfileAuthDomain.ts",
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
  "src/app/lib/pdfPreview.ts",
  "src/app/lib/privateImageFile.ts",
  "src/app/lib/privateImageMessage.ts",
  "src/app/lib/pwaNotifications.ts",
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
  "src/profileCache.ts",
  "src/utils/blossomUploadProxy.ts",
  "src/utils/bootDiagnostics.ts",
  "src/utils/browserPreferences.ts",
  "src/utils/colorMode.ts",
  "src/utils/formatting.ts",
  "src/utils/image.ts",
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
            ...pureJsPbkdf2ImportPatterns,
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
        ...routeReadSyntax,
        ...envSyntax,
      ],
    },
  },
  {
    files: ["src/platform/buildEnv.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...storageSyntax,
        ...navigationSyntax,
        ...routeReadSyntax,
      ],
    },
  },
  {
    files: commandLinkFiles,
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...storageSyntax,
        ...navigationSyntax,
        ...envSyntax,
      ],
    },
  },
  {
    files: ["src/app/state/**"],
    ignores: testHelperImportIgnores,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: stateImportPaths,
          patterns: [
            ...testHelperImportPatterns,
            ...evoluImportPatterns,
            ...wipeImportPatterns,
            ...stateImportPatterns,
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/evolu.ts",
      "src/evoluDb.worker.ts",
      "src/platform/evolu.web.ts",
      "src/app/migrations/**",
    ],
    ignores: testHelperImportIgnores,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...testHelperImportPatterns,
            ...wipeImportPatterns,
            ...pureJsPbkdf2ImportPatterns,
          ],
        },
      ],
      "no-restricted-properties": "off",
    },
  },
  {
    files: ["src/app/hooks/settings/useEvoluStorageWatchers.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...testHelperImportPatterns,
            ...evoluImportPatterns,
            ...pureJsPbkdf2ImportPatterns,
          ],
        },
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
        ...routeReadSyntax,
        ...envSyntax,
      ],
    },
  },
  {
    files: ["src/platform/navigation.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...storageSyntax,
        ...envSyntax,
      ],
    },
  },
  {
    files: ["src/utils/spdPayment.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedSyntax,
        ...backSyntax,
        ...storageSyntax,
        ...routeReadSyntax,
        ...envSyntax,
      ],
    },
  },
]);
