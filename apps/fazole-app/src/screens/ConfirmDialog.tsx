import { Button, Dialog } from "@linky-fit/ui";
import { copy } from "../copy";

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirm,
  destructive = false,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description: string;
  readonly confirm: string;
  readonly destructive?: boolean | undefined;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={title}
      description={description}
      actions={
        <>
          <Button
            testID="confirm-dialog-confirm"
            variant={destructive ? "danger" : "primary"}
            onPress={onConfirm}
          >
            {confirm}
          </Button>
          <Button variant="secondary" onPress={onClose}>
            {copy.cancel}
          </Button>
        </>
      }
    />
  );
}
