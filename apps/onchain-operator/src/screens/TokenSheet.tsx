import { Button, Sheet, Stack } from "@linky-fit/ui";
import { copy } from "../copy/en";
import { TokenView } from "./WalletParts";

/** A token issued earlier and not claimed yet, shown again to hand over. */
export function TokenSheet({
  token,
  onClose,
}: {
  readonly token: string | null;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open={token !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={copy.wallet.tokenTitle}
    >
      <Stack gap="$lg" paddingTop="$sm" testID="token-sheet">
        {token === null ? null : <TokenView token={token} />}
        <Button variant="ghost" onPress={onClose}>
          {copy.wallet.done}
        </Button>
      </Stack>
    </Sheet>
  );
}
