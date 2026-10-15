import { Stack, TextField } from "@linky-fit/ui";
import { copy } from "../copy";
import type { ShopForm } from "./shopForm";

/** The shop name and bank account, both optional, shared by setup and settings. */
export function ShopFields({ form }: { readonly form: ShopForm }) {
  const { accountCheck } = form;
  return (
    <Stack gap="$lg">
      <TextField
        testID="shop-name"
        label={copy.shopFields.name}
        placeholder={copy.shopFields.namePlaceholder}
        hint={copy.shopFields.nameHint}
        error={form.nameError}
        value={form.name}
        onChangeText={form.setName}
        maxLength={100}
        autoComplete="organization"
      />
      <TextField
        testID="shop-account"
        label={copy.shopFields.account}
        placeholder={copy.shopFields.accountPlaceholder}
        hint={
          accountCheck.kind === "valid" ? accountCheck.description : undefined
        }
        error={form.accountError}
        value={form.account}
        onChangeText={form.setAccount}
        onBlur={form.touchAccount}
        // The account needs "/" and "-", which numeric phone keyboards lack.
        inputMode="text"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        spellCheck={false}
      />
    </Stack>
  );
}
