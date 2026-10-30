import { Notice, Stack } from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../copy";
import { applyUpdate, subscribeNeedRefresh } from "../platform/pwaUpdate";

/** Offers a new release above every screen; it pushes the screen down, so the keypad and QR stay usable. */
export function UpdateBanner() {
  const [needRefresh, setNeedRefresh] = useState(false);
  useEffect(() => subscribeNeedRefresh(setNeedRefresh), []);
  if (!needRefresh) return null;
  return (
    <Stack gap="$none" backgroundColor="$accent">
      <Notice
        solid
        title={copy.update.available}
        icon="RefreshCcw"
        action={{ label: copy.update.apply, onPress: () => void applyUpdate() }}
      />
    </Stack>
  );
}
