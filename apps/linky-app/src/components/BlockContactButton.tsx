import { Button, Dialog } from "@linky-fit/ui";
import type { ButtonProps } from "@linky-fit/ui";
import { useState } from "react";
import type { Translate } from "../i18n";

interface BlockContactButtonProps extends Pick<
  ButtonProps,
  "disabled" | "flex"
> {
  onConfirm: () => Promise<void>;
  t: Translate;
}

/** Blocks a contact after the user confirms it in a dialog. */
export function BlockContactButton({
  onConfirm,
  t,
  ...buttonProps
}: BlockContactButtonProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        onPress={() => setConfirming(true)}
        {...buttonProps}
      >
        {t("blockContact")}
      </Button>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("chatUnknownContactBlockConfirm")}
        actions={
          <>
            <Button
              variant="danger"
              onPress={() => {
                setConfirming(false);
                void onConfirm();
              }}
            >
              {t("blockContact")}
            </Button>
            <Button variant="secondary" onPress={() => setConfirming(false)}>
              {t("cancel")}
            </Button>
          </>
        }
      />
    </>
  );
}
