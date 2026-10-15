import { useAtom, useAtomValue } from "@linky-fit/linkstr-react";
import { Button, Stack, TextField } from "@linky-fit/ui";
import { useRef, type ComponentRef, type FC } from "react";
import { useTranslation } from "../app/hooks/shell";
import { extractCashuTokenFromText } from "../app/lib/tokenText";
import { walletOpRunningAtom } from "../app/state/wallet/opQueue";
import { receiveTokenDraftAtom } from "../app/state/wallet/tokenActivity";
import { useWalletCommands } from "../app/hooks/wallet/useWalletCommands";

export const CashuTokenNewPage: FC = () => {
  const { saveCashuFromText } = useWalletCommands();
  const { t } = useTranslation();
  const cashuIsBusy = useAtomValue(walletOpRunningAtom);
  const [cashuDraft, setCashuDraft] = useAtom(receiveTokenDraftAtom);
  const cashuDraftRef = useRef<ComponentRef<typeof TextField>>(null);
  const saveToken = (tokenRaw: string) =>
    void saveCashuFromText(tokenRaw, { navigateToTokens: true });

  // A complete token is saved as soon as it lands in the field, whether it
  // arrives via the paste event or a keyboard/IME insert that only fires change.
  const handleDraftChange = (value: string) => {
    const token = cashuIsBusy ? null : extractCashuTokenFromText(value);
    if (token) {
      saveToken(token);
      return;
    }
    setCashuDraft(value);
  };

  return (
    <Stack gap="$lg">
      <TextField
        multiline
        ref={cashuDraftRef}
        label={t("cashuToken")}
        value={cashuDraft}
        onChangeText={handleDraftChange}
        placeholder={t("cashuPasteManualHint")}
      />
      <Button
        onPress={() => saveToken(cashuDraft)}
        disabled={!cashuDraft.trim() || cashuIsBusy}
      >
        {t("cashuSave")}
      </Button>
    </Stack>
  );
};
