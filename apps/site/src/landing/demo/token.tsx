import { Amount, Button, QRCode, Stack, Text } from "@linky-fit/ui";
import { DemoBody, DemoTopBar } from "./chrome";
import { noop } from "./noop";
import { enter, useCues } from "./playback";

const token =
  "cashuBo2Ftdmh0dHBzOi8vbWludC5saW5reS5maXRhdWNzYXRhdIGiYWlIAK0mjE0fWCZhcIWjYWEZEABhc3hANmMzYzA4MWRjOGMzNGU0ODYzNDNjOWMzYmFkZTFhZTEwZTJiN2Y2YWIzYjg0MTAzYzBjMWM1NDEwYTRkMmQ5ZmFjWCECTow0gckif0UwZRcjbPiDlJivyIxnA8iWm6aNncVAVdOjYWEZAgBhc3hANWRhZDY0ODgzZTE3MmE1MzkzY2EwYmZjYjNiYTBiN2M4NDI4OWU3YTRjYzI2OWVlNDlmOWJmN2RhODljNTRlMWFjWCEC__Zims446fCgyKr2YTcHBnmQlEzsvf961GgfJnIeSgWjYWEZAQBhc3hAYjk2NGVhNGQ2YWY0OTJjMzRlN2VlOTVmYWVmN2I5M2JkNDkzYzJhZmIzMTdhYTNkMWE5MmM3NTA4ZTlhNmM4MWFjWCECNu9CxF7wKs42bbGGyVxTKZJfZ42bKNfsNscAS2o-zdSjYWEYgGFzeEA0MDMxMTJlZTc2YmQ1OTI1YTQ5ODdmZjY4N2QwZTAxZTAxZTQ4M2RjZDQ3NmNiNjAxYzdkYWFkNmI1NzY5NDgxYWNYIQK4nIdwka3E4JoZqdrczaaZ5AUNvyhy3mt9DL_hRk1K6KNhYQhhc3hAYTAzMDc0NWI5ZjJhOGU5NGRiYzZmNWE0YmNjZWJkYTdiMGU0ZTU2NmM1ZGE0MTMyYjU0YWE4NWMyMjc4NDkwZGFjWCEC9H4aUNO-MaNbFgxbqX6r6ped1DMv7HXMP3fVpsOB5Nw";

// The token details, its QR code, then the actions.
const tokenCues = [100, 350, 750, 850, 950];

export function TokenShareScreen() {
  const passed = useCues(tokenCues);
  return (
    <>
      <DemoTopBar title="Token" leading="ChevronLeft" />
      <DemoBody paddingTop="$xxxl" gap="$lg">
        <Stack className={enter(passed > 0)}>
          <Amount
            value="5,000"
            unit="sat"
            size="md"
            caption="Mint: mint.linky.fit"
          />
        </Stack>
        <Stack className={enter(passed > 0)} gap="$sm">
          <Text color="$colorMuted">Created 10/3/2026, 6:42:36 PM</Text>
          <Text variant="caption" color="$colorMuted" textAlign="center">
            Issued, waiting to be claimed.
          </Text>
        </Stack>
        <Stack className={enter(passed > 1, "demo-zoom")}>
          <QRCode value={token} accessibilityLabel="Copy" onPress={noop} />
        </Stack>
        <Stack className={enter(passed > 2)}>
          <Button onPress={noop}>Send to Contact</Button>
        </Stack>
        <Stack className={enter(passed > 3)}>
          <Button variant="secondary" icon="Copy" onPress={noop}>
            Copy
          </Button>
        </Stack>
        <Stack className={enter(passed > 4)}>
          <Button variant="secondary" icon="Share2" onPress={noop}>
            Share
          </Button>
        </Stack>
      </DemoBody>
    </>
  );
}
