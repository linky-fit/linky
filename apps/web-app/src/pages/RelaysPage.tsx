import { Stack } from "@linky-fit/ui";
import React from "react";
import { EvoluRelaysSection } from "./EvoluRelaysSection";
import { NostrRelaysSection } from "./NostrRelaysSection";

export function RelaysPage(): React.ReactElement {
  return (
    <Stack gap="$lg">
      <NostrRelaysSection />
      <EvoluRelaysSection />
    </Stack>
  );
}
