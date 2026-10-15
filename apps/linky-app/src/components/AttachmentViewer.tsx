import { Button, Dialog, IconButton, Row, Stack, Text } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import type { ReactNode } from "react";

interface ViewerAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

interface AttachmentViewerProps {
  open: boolean;
  onClose: () => void;
  /** Names the dialog. */
  title: string;
  backLabel: string;
  errorText: string | null;
  actions: readonly ViewerAction[];
  children: ReactNode;
}

/** The full-screen viewer of a private image or PDF; tapping around the content closes it. */
export function AttachmentViewer({
  open,
  onClose,
  title,
  backLabel,
  errorText,
  actions,
  children,
}: AttachmentViewerProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      hideTitle
      fullScreen
      testID="attachment-viewer"
      actions={
        <Stack gap="$sm" width="100%" maxWidth="$sheetWidth" alignSelf="center">
          {errorText ? (
            <Text
              variant="label"
              color="$dangerText"
              textAlign="center"
              role="status"
            >
              {errorText}
            </Text>
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
      }
    >
      <Stack flex={1} minHeight={0} gap="$md">
        <Row width="100%" maxWidth="$contentWidth" alignSelf="center">
          <IconButton
            icon="ChevronLeft"
            accessibilityLabel={backLabel}
            onPress={onClose}
          />
        </Row>
        <Stack
          flex={1}
          minHeight={0}
          alignItems="center"
          justifyContent="center"
          overflow="hidden"
          onPress={onClose}
        >
          {children}
        </Stack>
      </Stack>
    </Dialog>
  );
}
