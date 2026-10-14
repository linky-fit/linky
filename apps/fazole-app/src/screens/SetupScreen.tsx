import {
  Button,
  Form,
  IconButton,
  Notice,
  Stack,
  SubmitButton,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy";
import { navigateTo } from "../platform/hashRoute";
import { useDevice, useSession } from "../services/react";
import { Page, WithTopBar } from "./Page";
import { ShopFields } from "./ShopFields";
import { useShopForm } from "./shopForm";

/**
 * Creates the account with its shop; an account that has no shop yet, e.g.
 * a Linky account restored here, gets its shop instead.
 */
export function SetupScreen() {
  const device = useDevice();
  const session = useSession();
  const form = useShopForm();
  const [saving, setSaving] = useState(false);
  // Signed in before saving anything: the account came without a shop.
  const noShop = session._tag === "SignedIn" && !saving;
  const [failed, setFailed] = useState(false);
  useEffect(() => device.prepareAccount(), [device]);

  const submit = async () => {
    const shop = form.submit();
    if (shop === null || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      if (session._tag === "SignedIn") await session.services.shop.save(shop);
      else await device.createAccount(shop);
      navigateTo("terminal");
    } catch (error) {
      console.warn("[fazole] shop setup failed", error);
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <WithTopBar
      topBar={
        <TopBar
          leading={
            noShop ? undefined : (
              <IconButton
                icon="ArrowLeft"
                accessibilityLabel={copy.back}
                onPress={() => navigateTo("welcome")}
              />
            )
          }
        />
      }
    >
      <Page testID="setup-screen">
        <Stack gap="$sm">
          <Text variant="heading" role="heading">
            {copy.setup.title}
          </Text>
          <Text color="$colorMuted">
            {noShop ? copy.setup.noShopDescription : copy.setup.description}
          </Text>
        </Stack>
        <Form onSubmit={() => void submit()} gap="$xl">
          <ShopFields form={form} />
          {failed ? <Notice tone="danger" title={copy.setup.failed} /> : null}
          <SubmitButton testID="setup-submit" loading={saving}>
            {copy.setup.submit}
          </SubmitButton>
        </Form>
        {noShop ? (
          <Button variant="ghost" onPress={device.resetDevice}>
            {copy.restoring.startOver}
          </Button>
        ) : null}
      </Page>
    </WithTopBar>
  );
}
