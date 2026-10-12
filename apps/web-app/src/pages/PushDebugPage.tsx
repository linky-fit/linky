import { Button, CodeBlock, Row, Stack } from "@linky-fit/ui";
import React from "react";
import { useAtomValue } from "@linky-fit/linkstr-react";
import { useCopyText, usePushToast, useTranslation } from "../app/hooks/shell";
import { currentNsecAtom } from "../app/state/session/session";
import { useArmedAction } from "../hooks/useArmedAction";
import { isNativePlatform } from "../platform/runtime";
import {
  appendPushDebugLog,
  clearPushDebugLog,
  readPushDebugLog,
  type PushDebugLogEntry,
} from "../utils/pushDebugLog";
import {
  registerPushNotifications,
  requestNotificationPermission,
  unregisterPushNotifications,
} from "../utils/pushNotifications";
import { safeLocalStorageGet, safeLocalStorageKeys } from "../utils/storage";
import {
  envNotificationServerUrl,
  envPushServerUrl,
} from "../platform/buildEnv";

interface PushDebugMessage {
  receivedAtIso: string;
  text: string;
}
interface PushDebugReport {
  cacheKeys: string[];
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  localStorageKeys: string[];
  notificationPermission: string;
  pushSubscriptionApplicationServerKey: string | null;
  pushSubscriptionEndpoint: string | null;
  pushSubscriptionKeys: {
    hasAuth: boolean;
    hasP256dh: boolean;
  } | null;
  serviceWorkerController: boolean;
  serviceWorkerRegistrations: Array<{
    activeScriptUrl: string | null;
    installingScriptUrl: string | null;
    scope: string;
    waitingScriptUrl: string | null;
  }>;
  storedDebugLog: PushDebugLogEntry[];
}
const INITIAL_REPORT: PushDebugReport = {
  cacheKeys: [],
  hasPushManager: false,
  hasServiceWorker: false,
  localStorageKeys: [],
  notificationPermission: "unsupported",
  pushSubscriptionApplicationServerKey: null,
  pushSubscriptionEndpoint: null,
  pushSubscriptionKeys: null,
  storedDebugLog: [],
  serviceWorkerController: false,
  serviceWorkerRegistrations: [],
};
async function resetServiceWorkersAndCaches(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
  }
  if ("caches" in globalThis) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((key) => caches.delete(key)));
  }
}
async function loadPushDebugReport(): Promise<PushDebugReport> {
  const report: PushDebugReport = {
    ...INITIAL_REPORT,
    hasPushManager: "PushManager" in window,
    hasServiceWorker: "serviceWorker" in navigator,
    localStorageKeys: safeLocalStorageKeys().sort(),
    notificationPermission:
      "Notification" in window ? Notification.permission : "unsupported",
    serviceWorkerController: Boolean(navigator.serviceWorker?.controller),
  };
  if ("caches" in globalThis) {
    try {
      report.cacheKeys = (await caches.keys()).sort();
    } catch {
      report.cacheKeys = [];
    }
  }
  report.storedDebugLog = await readPushDebugLog();
  if (!report.hasServiceWorker) {
    return report;
  }
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    report.serviceWorkerRegistrations = registrations.map((registration) => ({
      activeScriptUrl: registration.active?.scriptURL ?? null,
      installingScriptUrl: registration.installing?.scriptURL ?? null,
      scope: registration.scope,
      waitingScriptUrl: registration.waiting?.scriptURL ?? null,
    }));
    const readyRegistration = await navigator.serviceWorker.ready;
    const subscription = await readyRegistration.pushManager.getSubscription();
    const applicationServerKey = subscription?.options.applicationServerKey;
    report.pushSubscriptionEndpoint = subscription?.endpoint ?? null;
    report.pushSubscriptionApplicationServerKey =
      applicationServerKey === null || applicationServerKey === undefined
        ? null
        : btoa(String.fromCharCode(...new Uint8Array(applicationServerKey)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/g, "");
    report.pushSubscriptionKeys = subscription
      ? {
          hasAuth: Boolean(subscription.getKey("auth")),
          hasP256dh: Boolean(subscription.getKey("p256dh")),
        }
      : null;
  } catch {
    // ignore best-effort debug reads
  }
  return report;
}
type PushDebugAction =
  | "refresh"
  | "permission"
  | "register"
  | "unregister"
  | "reset"
  | "clearLogs";

export function PushDebugPage(): React.ReactElement {
  const currentNsec = useAtomValue(currentNsecAtom);
  const { t } = useTranslation();
  const copyText = useCopyText();
  const pushToast = usePushToast();
  const [report, setReport] = React.useState<PushDebugReport>(INITIAL_REPORT);
  const [messages, setMessages] = React.useState<PushDebugMessage[]>([]);
  const [busyAction, setBusyAction] = React.useState<PushDebugAction | null>(
    null,
  );
  const resetAction = useArmedAction(() =>
    pushToast(t("sensitiveActionArmedHint")),
  );
  const clearLogsAction = useArmedAction(() => pushToast(t("deleteArmedHint")));
  const refreshReport = React.useCallback(async () => {
    setReport(await loadPushDebugReport());
  }, []);
  React.useEffect(() => {
    void refreshReport();
  }, [refreshReport]);
  React.useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      const nextText = JSON.stringify(event.data);
      setMessages((prev) =>
        [
          {
            receivedAtIso: new Date().toISOString(),
            text: nextText,
          },
          ...prev,
        ].slice(0, 10),
      );
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);
  const run = async (action: PushDebugAction, task?: () => Promise<void>) => {
    setBusyAction(action);
    try {
      await task?.();
      await refreshReport();
    } finally {
      setBusyAction(null);
    }
  };
  const requestPermission = async () => {
    const granted = await requestNotificationPermission();
    pushToast(
      granted ? t("notificationsRegistered") : t("notificationsDenied"),
    );
  };
  const register = async () => {
    if (!currentNsec) {
      pushToast(t("notificationsNotLoggedIn"));
      return;
    }
    if (!isNativePlatform() && !("Notification" in window)) {
      pushToast(t("notificationsUnsupported"));
      return;
    }
    if (!isNativePlatform() && Notification.permission === "default") {
      if (!(await requestNotificationPermission())) {
        pushToast(t("notificationsDenied"));
        return;
      }
    }
    const result = await registerPushNotifications(currentNsec);
    pushToast(
      result.success
        ? t("notificationsRegistered")
        : (result.error ?? t("notificationsError")),
    );
  };
  const unregister = async () => {
    if (!currentNsec) {
      pushToast(t("notificationsNotLoggedIn"));
      return;
    }
    const ok = await unregisterPushNotifications(currentNsec);
    pushToast(ok ? "Unregistered" : "Unregister failed");
  };
  const reset = async () => {
    try {
      await resetServiceWorkersAndCaches();
      await clearPushDebugLog();
      pushToast("Service workers and caches reset");
    } catch (error) {
      pushToast(`Reset failed: ${String(error ?? "")}`);
    }
  };
  const clearLogs = async () => {
    await clearPushDebugLog();
    appendPushDebugLog("client", "debug log cleared from UI");
    pushToast("Debug log cleared");
  };
  const reportText = JSON.stringify(
    {
      ...report,
      env: {
        pushServerUrl: envPushServerUrl ?? envNotificationServerUrl ?? null,
        vapidPublicKey: safeLocalStorageGet("linky.push_vapid_public_key"),
      },
      recentMessages: messages,
    },
    null,
    2,
  );
  const actionButton = (
    action: PushDebugAction,
    label: string,
    onPress: () => void,
    armed = false,
  ) => (
    <Button
      size="sm"
      variant={armed ? "danger" : "secondary"}
      loading={busyAction === action}
      disabled={busyAction !== null}
      onPress={onPress}
    >
      {label}
    </Button>
  );
  return (
    <Stack gap="$lg">
      <Row flexWrap="wrap" gap="$sm">
        {actionButton("refresh", "Refresh", () => void run("refresh"))}
        {actionButton(
          "permission",
          "Permission",
          () => void run("permission", requestPermission),
        )}
        {actionButton(
          "register",
          "Register",
          () => void run("register", register),
        )}
        {actionButton(
          "unregister",
          "Unregister",
          () => void run("unregister", unregister),
        )}
        {actionButton(
          "reset",
          "Reset SW",
          () => resetAction.confirm(() => void run("reset", reset)),
          resetAction.armed,
        )}
        {actionButton(
          "clearLogs",
          "Clear logs",
          () => clearLogsAction.confirm(() => void run("clearLogs", clearLogs)),
          clearLogsAction.armed,
        )}
        <Button
          size="sm"
          variant="secondary"
          icon="Copy"
          onPress={() => void copyText(reportText)}
        >
          Copy logs
        </Button>
      </Row>

      <CodeBlock testID="push-debug-report">{reportText}</CodeBlock>
    </Stack>
  );
}
