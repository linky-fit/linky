import {
  Button,
  CameraPreview,
  Dialog,
  IconButton,
  ListRow,
  MediaFrame,
  Progress,
  Row,
  Sheet,
  Stack,
  Text,
} from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useRegisterTopModalDismiss } from "../app/hooks/shell/overlays";
import { useOnchainTransfersShown } from "../app/hooks/useOnchainTransfers";
import {
  useScanCommands,
  useScanShortcuts,
  useScanView,
  useSetScanPaused,
} from "../app/hooks/shell/scan";
import { useDesktopSplitView } from "../hooks/useDesktopSplitView";
import { navigateTo } from "../hooks/useRouting";

interface ScanAction {
  icon: IconName;
  label: string;
  onPress: () => void;
  ref?: React.RefObject<React.ComponentRef<typeof Button> | null>;
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
  const setScanPaused = useSetScanPaused();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreButtonRef = React.useRef<React.ComponentRef<typeof Button> | null>(
    null,
  );
  const setMoreSheetOpen = React.useCallback(
    (open: boolean) => {
      setScanPaused(open);
      setMoreOpen(open);
    },
    [setScanPaused],
  );
  const closeMoreSheet = React.useCallback(
    () => setMoreSheetOpen(false),
    [setMoreSheetOpen],
  );
  useRegisterTopModalDismiss(moreOpen, closeMoreSheet);
  React.useEffect(() => () => setScanPaused(false), [setScanPaused]);
  const animation = scanDiagnostics.animation;
  const animationFraction =
    animation === null || animation.expected === null
      ? 0
      : animation.received / animation.expected;
  const isReceiveScan = scanEntryPoint === "receive";
  const isSendScan = scanEntryPoint === "send";
  const handleClose = React.useCallback(() => {
    setMoreSheetOpen(false);
    closeScan();
  }, [closeScan, setMoreSheetOpen]);
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
  const gallery: ScanAction = {
    icon: "Images",
    label: t("scanGallery"),
    onPress: onPickScanImage,
  };
  const more: ScanAction = {
    icon: "Ellipsis",
    label: t("scanMoreOptions"),
    onPress: () => setMoreSheetOpen(true),
    ref: moreButtonRef,
  };
  const actions = [
    ...(showTypeAction ? [typeManually] : []),
    paste,
    ...(isReceiveScan
      ? [setAmount, gallery]
      : isSendScan
        ? [gallery, more]
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
        {animationHeadline === null ? null : (
          <Stack role="status" gap="$xs">
            <Progress
              value={animationFraction}
              accessibilityLabel={animationHeadline}
            />
            <Text variant="label" textAlign="center">
              {animationHeadline}
            </Text>
          </Stack>
        )}
        <Row gap="$sm">
          {actions.map((action) => (
            <Button
              key={action.label}
              ref={action.ref}
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

  // Rendered as a sibling of the full-screen Dialog so the Sheet opens above its top layer.
  const moreSheet = isSendScan ? (
    <Sheet
      open={moreOpen}
      onOpenChange={setMoreSheetOpen}
      title={t("scanMoreOptions")}
      returnFocusTo={moreButtonRef}
    >
      <ListRow
        icon="Keyboard"
        title={t("manualPayOpen")}
        onPress={() => {
          setMoreSheetOpen(false);
          onTypePayment();
        }}
      />
      <ListRow
        icon="BadgePlus"
        title={t("cashuEmit")}
        onPress={() => {
          setMoreSheetOpen(false);
          onIssueToken();
        }}
      />
      {onchainTransfersShown ? (
        <ListRow
          icon="Bitcoin"
          title={t("onchainSendTitle")}
          onPress={() => {
            setMoreSheetOpen(false);
            closeScan();
            navigateTo({ route: "onchainSend" });
          }}
          testID="scan-onchain-send"
        />
      ) : null}
    </Sheet>
  ) : null;

  if (isDesktopSplitView) {
    return (
      <>
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
        {moreSheet}
      </>
    );
  }

  return (
    <>
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
      {moreSheet}
    </>
  );
}
