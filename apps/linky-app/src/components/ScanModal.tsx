import {
  Button,
  CameraPreview,
  Dialog,
  IconButton,
  ListRow,
  MediaFrame,
  Progress,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useOnchainTransfersShown } from "../app/hooks/useOnchainTransfers";
import {
  useScanCommands,
  useScanShortcuts,
  useScanView,
} from "../app/hooks/shell/scan";
import { useInspectorEmissionEnabled } from "../devtools/inspector/inspectorEnabled";
import { useDesktopSplitView } from "../hooks/useDesktopSplitView";
import { navigateTo } from "../hooks/useRouting";

interface ScanAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

export function ScanModal(): React.ReactElement {
  const { closeScan, cycleScanCamera, onPickScanImage, pasteScanValue } =
    useScanCommands();
  const {
    openIssueTokenFromScan: onIssueToken,
    openManualPayFromScan: onTypePayment,
    openManualContactFromScan: onTypeManually,
  } = useScanShortcuts();
  const {
    scanDiagnostics,
    scanCanSwitchCamera,
    scanEntryPoint,
    scanVideoRef,
    scanAllowsManualContact: showTypeAction,
  } = useScanView();
  const { t } = useTranslation();
  const onchainTransfersShown = useOnchainTransfersShown();
  const isDesktopSplitView = useDesktopSplitView();
  // What the camera decodes is developer information; the progress of an
  // animation is not, so only the detail line waits for the inspector.
  const showScanDiagnostics = useInspectorEmissionEnabled();
  const animation = scanDiagnostics.animation;
  const animationFraction =
    animation === null || animation.expected === null
      ? 0
      : animation.received / animation.expected;
  const isReceiveScan = scanEntryPoint === "receive";
  const isSendScan = scanEntryPoint === "send";
  const handleClose = React.useCallback(() => {
    closeScan();
    if (isReceiveScan) {
      navigateTo({ route: "wallet" });
    }
  }, [closeScan, isReceiveScan]);
  const title =
    scanEntryPoint === "contacts"
      ? t("contactsScanContactQr")
      : scanEntryPoint === "receive"
        ? t("walletReceive")
        : scanEntryPoint === "send"
          ? t("walletSend")
          : t("scan");

  const animationHeadline =
    animation === null
      ? null
      : animation.expected === null
        ? t("scanAnimatedQrDetected")
        : t("scanAnimatedQrProgress")
            .replace("{received}", String(animation.received))
            .replace("{expected}", String(animation.expected))
            .replace("{percent}", String(Math.round(animationFraction * 100)));

  const typeManually: ScanAction = {
    icon: "Keyboard",
    label: t("scanTypeManually"),
    onPress: onTypeManually,
  };
  const paste: ScanAction = {
    icon: "ClipboardPaste",
    label: t("paste"),
    onPress: () => void pasteScanValue(),
  };
  const setAmount: ScanAction = {
    icon: "ArrowDownToLine",
    label: t("topupSetAmount"),
    onPress: () => {
      closeScan();
      navigateTo({ route: "topup" });
    },
  };
  const issueToken: ScanAction = {
    icon: "BadgePlus",
    label: t("cashuEmit"),
    onPress: onIssueToken,
  };
  const gallery: ScanAction = {
    icon: "Images",
    label: t("scanGallery"),
    onPress: onPickScanImage,
  };
  const actions = [
    ...(showTypeAction ? [typeManually] : []),
    paste,
    ...(isReceiveScan
      ? [setAmount, gallery]
      : isSendScan
        ? [issueToken, gallery]
        : showTypeAction
          ? []
          : [gallery]),
  ];

  const content = (
    <>
      <Stack flex={1} minHeight={0} data-scan-region="preview">
        <MediaFrame accessibilityLabel={t("scanCameraPreview")} fill>
          <CameraPreview videoRef={scanVideoRef} />
          {scanCanSwitchCamera ? (
            <Stack position="absolute" right="$md" bottom="$md">
              <Button
                variant="secondary"
                size="sm"
                icon="SwitchCamera"
                onPress={cycleScanCamera}
              >
                {t("scanSwitchCamera")}
              </Button>
            </Stack>
          ) : null}
        </MediaFrame>
      </Stack>

      <Stack
        gap="$sm"
        width="100%"
        maxWidth="$sheetWidth"
        alignSelf="center"
        data-scan-region="footer"
      >
        {animationHeadline === null && !showScanDiagnostics ? null : (
          <Stack role="status" gap="$xs">
            {animationHeadline === null ? null : (
              <>
                <Progress
                  value={animationFraction}
                  accessibilityLabel={animationHeadline}
                />
                <Text variant="label" textAlign="center">
                  {animationHeadline}
                </Text>
              </>
            )}
            {showScanDiagnostics ? (
              <Text
                variant="caption"
                mono
                color="$colorMuted"
                textAlign="center"
              >
                {t("scanDiagnosticsReads").replace(
                  "{reads}",
                  String(scanDiagnostics.reads),
                )}
                {scanDiagnostics.lastValue
                  ? ` · ${scanDiagnostics.lastValue}…`
                  : ""}
                {scanDiagnostics.lastRejection
                  ? ` · ${scanDiagnostics.lastRejection}`
                  : ""}
              </Text>
            ) : null}
          </Stack>
        )}
        {isSendScan ? (
          <ListRow
            icon="Keyboard"
            title={t("manualPayOpen")}
            onPress={onTypePayment}
          />
        ) : null}
        {isSendScan && onchainTransfersShown ? (
          <ListRow
            icon="Bitcoin"
            title={t("onchainSendTitle")}
            onPress={() => {
              closeScan();
              navigateTo({ route: "onchainSend" });
            }}
            testID="scan-onchain-send"
          />
        ) : null}
        <Row gap="$sm">
          {actions.map((action) => (
            <Button
              key={action.label}
              variant="secondary"
              icon={action.icon}
              flex={1}
              onPress={action.onPress}
            >
              {action.label}
            </Button>
          ))}
        </Row>
      </Stack>
    </>
  );

  if (isDesktopSplitView) {
    return (
      <Stack
        role="dialog"
        aria-label={title}
        flex={1}
        padding="$xl"
        backgroundColor="$background"
      >
        <Row justifyContent="space-between">
          <Text variant="title">{title}</Text>
          <IconButton
            icon="X"
            size="sm"
            accessibilityLabel={t("close")}
            onPress={handleClose}
          />
        </Row>
        {content}
      </Stack>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      title={title}
      closeLabel={t("close")}
      fullScreen
    >
      {content}
    </Dialog>
  );
}
