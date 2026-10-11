import { ListRow, Section, Spinner, Stack, Switch } from "@linky-fit/ui";
import React, { useEffect, useState } from "react";
import { usePushToast, useTranslation } from "../app/hooks/shell";
import {
  setInspectorEnabled,
  setInspectorLogsEnabled,
  useInspectorEnabled,
  useInspectorLogsEnabled,
} from "../devtools/inspector/inspectorEnabled";
import type { PersistentInspectorLogStats } from "../devtools/inspector/persistentInspectorLogBuffer";
import { useArmedAction } from "../hooks/useArmedAction";
import { navigateTo } from "../hooks/useRouting";
import { formatBytes } from "../utils/formatting";

const formatInspectorLogAge = (
  oldestAt: number | null,
  now: number,
): string => {
  if (oldestAt === null) return "—";
  const ageSeconds = Math.max(0, Math.floor((now - oldestAt) / 1_000));
  if (ageSeconds < 60) return `${ageSeconds}s`;
  const ageMinutes = Math.floor(ageSeconds / 60);
  if (ageMinutes < 60) return `${ageMinutes}m`;
  return `${Math.floor(ageMinutes / 60)}h`;
};

export function InspectorSettingsPage(): React.ReactElement {
  const inspectorEnabled = useInspectorEnabled();
  const inspectorLogsEnabled = useInspectorLogsEnabled();
  const pushToast = usePushToast();
  const { t } = useTranslation();

  const [inspectorLogStats, setInspectorLogStats] =
    useState<PersistentInspectorLogStats | null>(null);
  const [busyLogAction, setBusyLogAction] = useState<
    "download" | "clear" | null
  >(null);
  const clearLogsAction = useArmedAction(() => pushToast(t("deleteArmedHint")));

  const inspectorLogStatsLabel = inspectorLogStats
    ? t("nostrInspectorLogsStats")
        .replace("{count}", String(inspectorLogStats.rowCount))
        .replace("{size}", formatBytes(inspectorLogStats.totalSize))
        .replace(
          "{age}",
          formatInspectorLogAge(inspectorLogStats.oldestAt, Date.now()),
        )
    : t("nostrInspectorLogsLoading");

  useEffect(() => {
    if (!inspectorLogsEnabled) {
      setInspectorLogStats(null);
      return;
    }

    let active = true;
    let unsubscribe = (): void => undefined;
    void import("../devtools/inspector/persistentInspectorLogSink")
      .then(
        async ({
          initializePersistentInspectorLogs,
          subscribePersistentInspectorLogs,
        }) => {
          if (!active) return;
          unsubscribe = subscribePersistentInspectorLogs((stats) => {
            if (active) setInspectorLogStats(stats);
          });
          const stats = await initializePersistentInspectorLogs();
          if (active) setInspectorLogStats(stats);
        },
      )
      .catch(() => {
        if (active) pushToast(t("nostrInspectorLogsError"));
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [inspectorLogsEnabled, pushToast, t]);

  const downloadInspectorLogs = async (): Promise<void> => {
    setBusyLogAction("download");
    try {
      const { downloadPersistentInspectorLogs } =
        await import("../devtools/inspector/persistentInspectorLogSink");
      await downloadPersistentInspectorLogs();
      pushToast(t("nostrInspectorLogsDownloaded"));
    } catch {
      pushToast(t("nostrInspectorLogsError"));
    } finally {
      setBusyLogAction(null);
    }
  };

  const clearInspectorLogs = async (): Promise<void> => {
    setBusyLogAction("clear");
    try {
      const { clearPersistentInspectorLogs } =
        await import("../devtools/inspector/persistentInspectorLogSink");
      await clearPersistentInspectorLogs();
      pushToast(t("nostrInspectorLogsCleared"));
    } catch {
      pushToast(t("nostrInspectorLogsError"));
    } finally {
      setBusyLogAction(null);
    }
  };

  const logActionsDisabled =
    !inspectorLogsEnabled ||
    busyLogAction !== null ||
    !inspectorLogStats?.rowCount;

  return (
    <Stack gap="$lg">
      <Section>
        <ListRow
          icon="Bug"
          title={t("nostrInspector")}
          trailing={
            <Switch
              accessibilityLabel={t("nostrInspector")}
              value={inspectorEnabled}
              onValueChange={setInspectorEnabled}
            />
          }
        />

        <ListRow
          icon="Eye"
          title={t("openNostrInspector")}
          onPress={() => navigateTo({ route: "advancedInspectorTimeline" })}
        />
      </Section>

      <Section>
        <ListRow
          icon="FileText"
          title={t("nostrInspectorLogs")}
          description={
            inspectorLogsEnabled ? inspectorLogStatsLabel : undefined
          }
          trailing={
            <Switch
              accessibilityLabel={t("nostrInspectorLogs")}
              value={inspectorLogsEnabled}
              onValueChange={setInspectorLogsEnabled}
            />
          }
        />

        <ListRow
          icon="Download"
          title={t("downloadNostrInspectorLogs")}
          onPress={() => void downloadInspectorLogs()}
          trailing={busyLogAction === "download" ? <Spinner /> : null}
          disabled={logActionsDisabled}
        />

        <ListRow
          icon="Trash2"
          title={t("clearNostrInspectorLogs")}
          destructive={clearLogsAction.armed}
          onPress={() =>
            clearLogsAction.confirm(() => void clearInspectorLogs())
          }
          trailing={busyLogAction === "clear" ? <Spinner /> : null}
          disabled={logActionsDisabled}
        />
      </Section>

      <Section>
        <ListRow
          icon="FlaskConical"
          title={t("pushDebug")}
          onPress={() => navigateTo({ route: "advancedPushDebug" })}
        />
      </Section>
    </Stack>
  );
}
