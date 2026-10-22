import type { MintUrl } from "@linky-fit/linkshu";
import { Button, Notice, QRCode, SelectField, Stack } from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy/en";
import type { MintFunds } from "../domain/wallet";
import { copyText } from "../platform/clipboard";

/** Picks one of several funded mints; nothing to pick with only one. */
export function MintField({
  funds,
  source,
  onPick,
}: {
  readonly funds: readonly MintFunds[];
  readonly source: MintFunds;
  readonly onPick: (mint: MintUrl) => void;
}) {
  if (funds.length < 2) return null;
  return (
    <SelectField
      label={copy.wallet.mint}
      value={source.mint}
      options={funds.map(({ mint }) => ({ value: mint, label: mint }))}
      onValueChange={onPick}
    />
  );
}

/** A token to hand over: the spend warning, its QR code and a copy button. */
export function TokenView({ token }: { readonly token: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <Stack gap="$lg" testID="token-view">
      <Notice
        tone="warning"
        icon="TriangleAlert"
        title={copy.wallet.tokenWarning}
        description={copy.wallet.tokenWarningDetail}
      />
      <Stack alignItems="center">
        <QRCode value={token} accessibilityLabel={copy.wallet.tokenQr} />
      </Stack>
      <Button
        testID="token-copy"
        variant="secondary"
        icon={copied === true ? "Check" : "Copy"}
        onPress={() => void copyText(token).then(setCopied)}
      >
        {copied === true ? copy.wallet.copied : copy.wallet.copyToken}
      </Button>
      {copied === false ? (
        <Notice tone="danger" title={copy.wallet.copyFailed} />
      ) : null}
    </Stack>
  );
}
