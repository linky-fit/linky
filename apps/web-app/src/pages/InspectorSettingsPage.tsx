import { Bug, Download, FlaskConical, Trash2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { SettingsLinkRow, SettingsToggleRow } from "../components/SettingsRows";
import {
  setInspectorEnabled,
  setInspectorLogsEnabled,
  useInspectorEnabled,
  useInspectorLogsEnabled,
} from "../devtools/inspector/inspectorEnabled";
import type { PersistentInspectorLogStats } from "../devtools/inspector/persistentInspectorLogBuffer";
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
  const { pushToast } = useAdvancedSettingsContext();
  const { t } = useAppShellCore();

  const [inspectorLogStats, setInspectorLogStats] =
    useState<PersistentInspectorLogStats | null>(null);
  const [inspectorLogActionIsBusy, setInspectorLogActionIsBusy] =
    useState(false);

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
    setInspectorLogActionIsBusy(true);
    try {
      const { downloadPersistentInspectorLogs } =
        await import("../devtools/inspector/persistentInspectorLogSink");
      await downloadPersistentInspectorLogs();
      pushToast(t("nostrInspectorLogsDownloaded"));
    } catch {
      pushToast(t("nostrInspectorLogsError"));
    } finally {
      setInspectorLogActionIsBusy(false);
    }
  };

  const clearInspectorLogs = async (): Promise<void> => {
    setInspectorLogActionIsBusy(true);
    try {
      const { clearPersistentInspectorLogs } =
        await import("../devtools/inspector/persistentInspectorLogSink");
      await clearPersistentInspectorLogs();
      pushToast(t("nostrInspectorLogsCleared"));
    } catch {
      pushToast(t("nostrInspectorLogsError"));
    } finally {
      setInspectorLogActionIsBusy(false);
    }
  };

  return (
    <section className="panel settings-page">
      <div className="settings-section">
        <SettingsToggleRow
          icon={<Bug size={18} />}
          label={t("nostrInspector")}
          checked={inspectorEnabled}
          onChange={setInspectorEnabled}
        />

        <SettingsLinkRow
          onClick={() => navigateTo({ route: "advancedInspectorTimeline" })}
          icon={<Bug size={18} />}
          label={t("openNostrInspector")}
        />
      </div>

      <div className="settings-section">
        <SettingsToggleRow
          icon={<Bug size={18} />}
          label={t("nostrInspectorLogs")}
          checked={inspectorLogsEnabled}
          onChange={setInspectorLogsEnabled}
        />

        {inspectorLogsEnabled ? (
          <div className="inspector-log-stats" aria-live="polite">
            {inspectorLogStatsLabel}
          </div>
        ) : null}

        <SettingsLinkRow
          onClick={() => void downloadInspectorLogs()}
          disabled={
            !inspectorLogsEnabled ||
            inspectorLogActionIsBusy ||
            !inspectorLogStats?.rowCount
          }
          icon={<Download size={18} />}
          label={t("downloadNostrInspectorLogs")}
        />

        <SettingsLinkRow
          onClick={() => void clearInspectorLogs()}
          disabled={
            !inspectorLogsEnabled ||
            inspectorLogActionIsBusy ||
            !inspectorLogStats?.rowCount
          }
          icon={<Trash2 size={18} />}
          label={t("clearNostrInspectorLogs")}
        />
      </div>

      <div className="settings-section">
        <SettingsLinkRow
          onClick={() => navigateTo({ route: "advancedPushDebug" })}
          icon={<FlaskConical size={18} />}
          label="Push / SW Debug (log)"
        />
      </div>
    </section>
  );
}
