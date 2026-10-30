import { Button, Dialog, Text, TextField } from "@linky-fit/ui";
import { Result } from "effect";
import { useState } from "react";
import { copy } from "../copy";
import { formatCzechIban, type ShopProfile } from "../domain";
import type { ConnectFailure } from "../services/bankPayments";
import { useAppServices } from "../services/react";
import type { MonetaConnection } from "../storage/monetaSetting";

/** Connects the shop's MONETA account with a token from Internet Banka, or removes the connection it has. */
export function MonetaDialog({
  shop,
  connection,
  onClose,
}: {
  readonly shop: ShopProfile;
  /** The connection to the shop's current account; `null` while there is none. */
  readonly connection: MonetaConnection | null;
  readonly onClose: () => void;
}) {
  const { bankPayments } = useAppServices();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const account = shop.iban === null ? "" : formatCzechIban(shop.iban);
  const failureText = (reason: ConnectFailure) => {
    const message = copy.settings.monetaFailures[reason];
    return typeof message === "string" ? message : message(account);
  };
  const connect = async () => {
    setBusy(true);
    setFailure(null);
    const result = await bankPayments.connect(token);
    if (Result.isSuccess(result)) {
      onClose();
      return;
    }
    setFailure(result.failure);
    setBusy(false);
  };
  const disconnect = async () => {
    setBusy(true);
    await bankPayments.disconnect();
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={copy.settings.monetaTitle}
      closeLabel={copy.close}
      testID="moneta-dialog"
      actions={
        connection === null ? (
          <Button
            testID="moneta-connect"
            loading={busy}
            disabled={token.trim() === ""}
            onPress={() => void connect()}
          >
            {copy.settings.monetaConnect}
          </Button>
        ) : (
          <Button
            testID="moneta-disconnect"
            variant="secondary"
            loading={busy}
            onPress={() => void disconnect()}
          >
            {copy.settings.monetaDisconnect}
          </Button>
        )
      }
    >
      {connection === null ? (
        <>
          <Text color="$colorMuted">{copy.settings.monetaDescription}</Text>
          <TextField
            testID="moneta-token"
            label={copy.settings.monetaToken}
            value={token}
            onChangeText={(value) => {
              setToken(value);
              setFailure(null);
            }}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            spellCheck={false}
            error={failure === null ? undefined : failureText(failure)}
          />
        </>
      ) : (
        <Text testID="moneta-connected">
          {copy.settings.monetaConnected(account)}
        </Text>
      )}
    </Dialog>
  );
}
