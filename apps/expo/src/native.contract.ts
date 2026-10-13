// Each `.native` module must export what its web sibling exports, with
// compatible types. Checked by tsconfig.contract.json, which resolves without
// moduleSuffixes so a bare path names the web module.
import type * as webUsePushNotificationsSetting from "@linky-fit/linky-app/src/app/hooks/usePushNotificationsSetting";
import * as nativeUsePushNotificationsSetting from "@linky-fit/linky-app/src/app/hooks/usePushNotificationsSetting.native";
import type * as webUsePushRegistrationLifecycle from "@linky-fit/linky-app/src/app/hooks/usePushRegistrationLifecycle";
import * as nativeUsePushRegistrationLifecycle from "@linky-fit/linky-app/src/app/hooks/usePushRegistrationLifecycle.native";
import type * as webKeryxCacheStorage from "@linky-fit/linky-app/src/app/lib/keryxCacheStorage";
import * as nativeKeryxCacheStorage from "@linky-fit/linky-app/src/app/lib/keryxCacheStorage.native";
import type * as webPdfPreview from "@linky-fit/linky-app/src/app/lib/pdfPreview";
import * as nativePdfPreview from "@linky-fit/linky-app/src/app/lib/pdfPreview.native";
import type * as webChatMessageEditor from "@linky-fit/linky-app/src/components/ChatMessageEditor";
import * as nativeChatMessageEditor from "@linky-fit/linky-app/src/components/ChatMessageEditor.native";
import type * as webInstallPwaBanner from "@linky-fit/linky-app/src/components/InstallPwaBanner";
import * as nativeInstallPwaBanner from "@linky-fit/linky-app/src/components/InstallPwaBanner.native";
import type * as webUseDesktopSplitView from "@linky-fit/linky-app/src/hooks/useDesktopSplitView";
import * as nativeUseDesktopSplitView from "@linky-fit/linky-app/src/hooks/useDesktopSplitView.native";
import type * as webAppEvents from "@linky-fit/linky-app/src/platform/appEvents";
import * as nativeAppEvents from "@linky-fit/linky-app/src/platform/appEvents.native";
import type * as webBrowserPolyfills from "@linky-fit/linky-app/src/platform/browserPolyfills";
import * as nativeBrowserPolyfills from "@linky-fit/linky-app/src/platform/browserPolyfills.native";
import type * as webDeviceMotion from "@linky-fit/linky-app/src/platform/deviceMotion";
import * as nativeDeviceMotion from "@linky-fit/linky-app/src/platform/deviceMotion.native";
import type * as webHashLinks from "@linky-fit/linky-app/src/platform/hashLinks";
import * as nativeHashLinks from "@linky-fit/linky-app/src/platform/hashLinks.native";
import type * as webLogoutWipe from "@linky-fit/linky-app/src/platform/logoutWipe";
import * as nativeLogoutWipe from "@linky-fit/linky-app/src/platform/logoutWipe.native";
import type * as webNativeBridge from "@linky-fit/linky-app/src/platform/nativeBridge";
import * as nativeNativeBridge from "@linky-fit/linky-app/src/platform/nativeBridge.native";
import type * as webReload from "@linky-fit/linky-app/src/platform/reload";
import * as nativeReload from "@linky-fit/linky-app/src/platform/reload.native";
import type * as webRuntime from "@linky-fit/linky-app/src/platform/runtime";
import * as nativeRuntime from "@linky-fit/linky-app/src/platform/runtime.native";
import type * as webSecretStorage from "@linky-fit/linky-app/src/platform/secretStorage";
import * as nativeSecretStorage from "@linky-fit/linky-app/src/platform/secretStorage.native";
import type * as webStorageEvents from "@linky-fit/linky-app/src/platform/storageEvents";
import * as nativeStorageEvents from "@linky-fit/linky-app/src/platform/storageEvents.native";
import type * as webSystemColorScheme from "@linky-fit/linky-app/src/platform/systemColorScheme";
import * as nativeSystemColorScheme from "@linky-fit/linky-app/src/platform/systemColorScheme.native";
import type * as webPwaUpdate from "@linky-fit/linky-app/src/utils/pwaUpdate";
import * as nativePwaUpdate from "@linky-fit/linky-app/src/utils/pwaUpdate.native";
import type * as webClipboard from "@linky-fit/linky-app/src/platform/clipboard";
import * as nativeClipboard from "@linky-fit/linky-app/src/platform/clipboard.native";
import type * as webFileExport from "@linky-fit/linky-app/src/platform/fileExport";
import * as nativeFileExport from "@linky-fit/linky-app/src/platform/fileExport.native";
import type * as webFiles from "@linky-fit/linky-app/src/platform/files";
import * as nativeFiles from "@linky-fit/linky-app/src/platform/files.native";
import type * as webQrCamera from "@linky-fit/linky-app/src/platform/QrCamera";
import * as nativeQrCamera from "@linky-fit/linky-app/src/platform/QrCamera.native";
import type * as webTextShare from "@linky-fit/linky-app/src/platform/textShare";
import * as nativeTextShare from "@linky-fit/linky-app/src/platform/textShare.native";
import type * as webImage from "@linky-fit/linky-app/src/utils/image";
import * as nativeImage from "@linky-fit/linky-app/src/utils/image.native";
import type * as webPickFile from "@linky-fit/linky-app/src/utils/pickFile";
import * as nativePickFile from "@linky-fit/linky-app/src/utils/pickFile.native";
import type * as webSpdPayment from "@linky-fit/linky-app/src/utils/spdPayment";
import * as nativeSpdPayment from "@linky-fit/linky-app/src/utils/spdPayment.native";
import type * as webSelfieCaptureModal from "@linky-fit/linky-app/src/components/SelfieCaptureModal";
import * as nativeSelfieCaptureModal from "@linky-fit/linky-app/src/components/SelfieCaptureModal.native";
import type * as webBankPaymentOfferSpdStore from "@linky-fit/linky-app/src/platform/bankPaymentOfferSpdStore";
import * as nativeBankPaymentOfferSpdStore from "@linky-fit/linky-app/src/platform/bankPaymentOfferSpdStore.native";
import type * as webScreenOrientation from "@linky-fit/linky-app/src/platform/screenOrientation";
import * as nativeScreenOrientation from "@linky-fit/linky-app/src/platform/screenOrientation.native";
import type * as webBuildEnv from "./buildEnv";
import * as nativeBuildEnv from "./buildEnv.native";
import type * as webMain from "./main";
import * as nativeMain from "./main.native";
import type * as webNavigation from "./navigation";
import * as nativeNavigation from "./navigation.native";
import type * as webUseGuideHighlight from "@linky-fit/linky-app/src/platform/useGuideHighlight";
import * as nativeUseGuideHighlight from "@linky-fit/linky-app/src/platform/useGuideHighlight.native";

export const usePushNotificationsSetting: typeof webUsePushNotificationsSetting =
  nativeUsePushNotificationsSetting;
export const usePushRegistrationLifecycle: typeof webUsePushRegistrationLifecycle =
  nativeUsePushRegistrationLifecycle;
export const keryxCacheStorage: typeof webKeryxCacheStorage =
  nativeKeryxCacheStorage;
export const pdfPreview: typeof webPdfPreview = nativePdfPreview;
export const ChatMessageEditor: typeof webChatMessageEditor =
  nativeChatMessageEditor;
export const InstallPwaBanner: typeof webInstallPwaBanner =
  nativeInstallPwaBanner;
export const useDesktopSplitView: typeof webUseDesktopSplitView =
  nativeUseDesktopSplitView;
export const appEvents: typeof webAppEvents = nativeAppEvents;
export const browserPolyfills: typeof webBrowserPolyfills =
  nativeBrowserPolyfills;
export const deviceMotion: typeof webDeviceMotion = nativeDeviceMotion;
export const hashLinks: typeof webHashLinks = nativeHashLinks;
export const logoutWipe: typeof webLogoutWipe = nativeLogoutWipe;
export const nativeBridge: typeof webNativeBridge = nativeNativeBridge;
export const reload: typeof webReload = nativeReload;
export const runtime: typeof webRuntime = nativeRuntime;
export const secretStorage: typeof webSecretStorage = nativeSecretStorage;
export const storageEvents: typeof webStorageEvents = nativeStorageEvents;
export const systemColorScheme: typeof webSystemColorScheme =
  nativeSystemColorScheme;
export const pwaUpdate: typeof webPwaUpdate = nativePwaUpdate;
export const buildEnv: typeof webBuildEnv = nativeBuildEnv;
export const main: typeof webMain = nativeMain;
export const navigation: typeof webNavigation = nativeNavigation;
export const clipboard: typeof webClipboard = nativeClipboard;
export const fileExport: typeof webFileExport = nativeFileExport;
export const files: typeof webFiles = nativeFiles;
export const qrCamera: typeof webQrCamera = nativeQrCamera;
export const textShare: typeof webTextShare = nativeTextShare;
export const image: typeof webImage = nativeImage;
export const pickFile: typeof webPickFile = nativePickFile;
export const spdPayment: typeof webSpdPayment = nativeSpdPayment;
export const selfieCaptureModal: typeof webSelfieCaptureModal =
  nativeSelfieCaptureModal;
export const bankPaymentOfferSpdStore: typeof webBankPaymentOfferSpdStore =
  nativeBankPaymentOfferSpdStore;
export const screenOrientation: typeof webScreenOrientation =
  nativeScreenOrientation;
export const useGuideHighlight: typeof webUseGuideHighlight =
  nativeUseGuideHighlight;
