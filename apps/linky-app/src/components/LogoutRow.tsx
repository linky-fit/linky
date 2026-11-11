import { Button, Dialog, ListRow } from "@linky-fit/ui";
import { useState } from "react";
import type { Translate } from "../i18n";

interface LogoutRowProps {
  /** An unsynced device loses changes and funds that never reached a server. */
  evoluConnected: boolean;
  /** Opens the keys backup; omitted when there are no keys to show. */
  onBackUpKeys?: (() => void) | undefined;
  onConfirm: () => void;
  t: Translate;
}

/** Logs out after the user confirms that their keys are backed up. */
export function LogoutRow({
  evoluConnected,
  onBackUpKeys,
  onConfirm,
  t,
}: LogoutRowProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <ListRow
        icon="LogOut"
        title={t("logout")}
        testID="logout"
        onPress={() => setConfirming(true)}
      />
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("logoutConfirmTitle")}
        description={t(
          evoluConnected ? "logoutConfirmBody" : "logoutConfirmUnsyncedBody",
        )}
        actions={
          <>
            <Button
              variant="danger"
              icon="LogOut"
              onPress={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              {t("logoutConfirmBackedUp")}
            </Button>
            {onBackUpKeys ? (
              <Button
                variant="secondary"
                icon="ShieldCheck"
                onPress={() => {
                  setConfirming(false);
                  onBackUpKeys();
                }}
              >
                {t("logoutConfirmBackUpFirst")}
              </Button>
            ) : null}
            <Button variant="secondary" onPress={() => setConfirming(false)}>
              {t("back")}
            </Button>
          </>
        }
      />
    </>
  );
}
