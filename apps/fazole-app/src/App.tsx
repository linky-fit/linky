import { Stack, UIProvider } from "@linky-fit/ui";
import type { Device } from "./services/device";
import { DeviceProvider } from "./services/DeviceProvider";
import { AppShell } from "./shell/AppShell";
import { UpdateBanner } from "./shell/UpdateBanner";

export function App({ device }: { readonly device: Device }) {
  return (
    <UIProvider mode="dark" brand="fazole">
      <DeviceProvider device={device}>
        <Stack flex={1} gap="$none" backgroundColor="$background">
          <UpdateBanner />
          <AppShell />
        </Stack>
      </DeviceProvider>
    </UIProvider>
  );
}
