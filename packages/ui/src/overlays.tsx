import type { ReactNode } from "react";
import { Dialog as TamaguiDialog, useMedia, VisuallyHidden } from "tamagui";
import { IconButton } from "./controls";
import { useDialogBehavior } from "./dialogBehavior";
import { Row, ScrollList, Stack } from "./layout";
import { textVariant } from "./styles";
import { enterScale, shadow, space } from "./tokens";

const fade = { opacity: 0 } as const;
const pop = { opacity: 0, scale: enterScale.subtle } as const;
const rise = { opacity: 0, y: space.huge } as const;

const placements = {
  center: {
    portal: { padding: "$xxl" },
    content: {
      enterStyle: pop,
      exitStyle: pop,
      gap: "$md",
      padding: "$xl",
      width: "$sheetWidth",
      maxWidth: "100%",
      borderRadius: "$card",
      backgroundColor: "$surface",
      boxShadow: shadow.floating,
    },
  },
  fullScreen: {
    portal: { padding: "$none" },
    content: {
      enterStyle: fade,
      exitStyle: fade,
      gap: "$md",
      padding: "$xl",
      width: "100%",
      height: "100%",
      borderWidth: 0,
      borderRadius: "$none",
      backgroundColor: "$background",
    },
  },
  bottom: {
    portal: {
      paddingTop: "$huge",
      paddingHorizontal: "$none",
      paddingBottom: "$none",
      justifyContent: "flex-end",
    },
    content: {
      enterStyle: rise,
      exitStyle: rise,
      gap: "$sm",
      paddingHorizontal: "$xl",
      paddingTop: "$md",
      paddingBottom: "$xxl",
      width: "100%",
      maxWidth: "$sheetWidth",
      borderTopLeftRadius: "$sheet",
      borderTopRightRadius: "$sheet",
      backgroundColor: "$surface",
      boxShadow: shadow.floating,
    },
  },
} as const;

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement: keyof typeof placements;
  described: boolean;
  testID?: string | undefined;
  children: ReactNode;
}

/** Tamagui's dialog: focus trap, Escape, Android back and focus return on every placement. */
function Modal({
  open,
  onOpenChange,
  placement,
  described,
  testID,
  children,
}: ModalProps) {
  const behavior = useDialogBehavior(open, onOpenChange);
  const styles = placements[placement];
  return (
    <TamaguiDialog modal open={open} onOpenChange={onOpenChange}>
      <TamaguiDialog.Portal {...styles.portal} zIndex="$overlay">
        <TamaguiDialog.Overlay
          key="overlay"
          backgroundColor="$scrim"
          transition="fast"
          enterStyle={fade}
          exitStyle={fade}
          onPress={() => onOpenChange(false)}
        />
        <TamaguiDialog.Content
          key="content"
          {...behavior}
          {...styles.content}
          // Without a Description, drop Tamagui's dangling aria-describedby id.
          {...(described ? {} : { "aria-describedby": undefined })}
          testID={testID}
          transition="base"
          maxHeight="100%"
        >
          {children}
        </TamaguiDialog.Content>
      </TamaguiDialog.Portal>
    </TamaguiDialog>
  );
}

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Hides the visible title; it still names the dialog for assistive technology. */
  hideTitle?: boolean | undefined;
  description?: string | undefined;
  /** Shows a close button with this accessibility label. */
  closeLabel?: string | undefined;
  /** Rendered below the content, typically one or two buttons. */
  actions?: ReactNode;
  fullScreen?: boolean | undefined;
  children?: ReactNode;
  testID?: string | undefined;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  closeLabel,
  actions,
  fullScreen = false,
  children,
  testID,
}: DialogProps) {
  const titleText = (
    <TamaguiDialog.Title
      flex={1}
      fontFamily="$body"
      {...textVariant("title")}
      color="$color"
    >
      {title}
    </TamaguiDialog.Title>
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      placement={fullScreen ? "fullScreen" : "center"}
      described={description !== undefined}
      testID={testID}
    >
      {hideTitle ? <VisuallyHidden>{titleText}</VisuallyHidden> : null}
      {hideTitle && !closeLabel ? null : (
        <Row justifyContent="flex-end">
          {hideTitle ? null : titleText}
          {closeLabel ? (
            <IconButton
              icon="X"
              accessibilityLabel={closeLabel}
              size="sm"
              onPress={() => onOpenChange(false)}
            />
          ) : null}
        </Row>
      )}
      {description === undefined ? null : (
        <TamaguiDialog.Description
          fontFamily="$body"
          {...textVariant("label")}
          fontWeight="$regular"
          color="$colorSubtle"
        >
          {description}
        </TamaguiDialog.Description>
      )}
      {fullScreen ? (
        <Stack flex={1} minHeight={0}>
          {children}
        </Stack>
      ) : (
        <ScrollList flexShrink={1}>
          <Stack>{children}</Stack>
        </ScrollList>
      )}
      {actions ? <Stack gap="$sm">{actions}</Stack> : null}
    </Modal>
  );
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Hides the visible title; it still names the sheet for assistive technology. */
  hideTitle?: boolean | undefined;
  children: ReactNode;
}

/** A bottom sheet for action lists and pickers, centered on wide screens; its content scrolls when it outgrows the screen. */
export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  children,
}: SheetProps) {
  const { wide } = useMedia();
  const titleText = (
    <TamaguiDialog.Title
      fontFamily="$body"
      {...textVariant("label")}
      color="$colorMuted"
      paddingVertical="$xs"
    >
      {title}
    </TamaguiDialog.Title>
  );
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      placement={wide ? "center" : "bottom"}
      described={false}
    >
      {hideTitle ? <VisuallyHidden>{titleText}</VisuallyHidden> : titleText}
      <ScrollList flexShrink={1}>
        <Stack>{children}</Stack>
      </ScrollList>
    </Modal>
  );
}
