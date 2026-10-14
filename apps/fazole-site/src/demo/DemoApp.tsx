import { Stack, TabBar } from "@linky-fit/ui";
import type { NavItem } from "@linky-fit/ui";
import { useCallback, useState } from "react";
import { copy } from "../copy";
import { PhoneFrame } from "./chrome";
import { HistoryMock } from "./screens/HistoryMock";
import { PaymentMock } from "./screens/PaymentMock";
import { SettingsMock } from "./screens/SettingsMock";
import { TerminalMock } from "./screens/TerminalMock";
import type { TerminalStart } from "./screens/TerminalMock";
import { WalletMock } from "./screens/WalletMock";

type Section = "terminal" | "history" | "wallet" | "settings";

/** Where a phone opens; "tips" is the terminal on its tip step. */
export type DemoStart = Section | "tips";

type Route = { section: Section } | { paymentId: string };

const t = copy.demo;

const navItems: NavItem<Section>[] = [
  { value: "terminal", label: t.sections.terminal, icon: "QrCode" },
  { value: "history", label: t.sections.history, icon: "History" },
  { value: "wallet", label: t.sections.wallet, icon: "Wallet" },
  { value: "settings", label: t.sections.settings, icon: "Settings" },
];

const emptyTerminal: TerminalStart = { input: "", tipping: false };
const tippingTerminal: TerminalStart = { input: "250", tipping: true };

/** The app with demo data in a phone: real UI components, working navigation. */
export function DemoApp({
  start,
  accessibilityLabel,
  maxWidth,
}: {
  start: DemoStart;
  accessibilityLabel: string;
  maxWidth: number;
}) {
  const [route, setRoute] = useState<Route>({
    section: start === "tips" ? "terminal" : start,
  });
  // Only the first terminal of the tips phone opens on the tip step.
  const [terminalStart, setTerminalStart] = useState(
    start === "tips" ? tippingTerminal : emptyTerminal,
  );
  const openPayment = useCallback((paymentId: string) => {
    setTerminalStart(emptyTerminal);
    setRoute({ paymentId });
  }, []);
  const toTerminal = useCallback(() => setRoute({ section: "terminal" }), []);

  const screen = () => {
    if ("paymentId" in route) {
      return <PaymentMock paymentId={route.paymentId} onDone={toTerminal} />;
    }
    const tabBar = (
      // Reaches under the phone's home indicator.
      <Stack gap="$none" paddingBottom="$lg" backgroundColor="$surface">
        <TabBar
          accessibilityLabel={t.navigation}
          items={navItems}
          value={route.section}
          onValueChange={(section) => setRoute({ section })}
        />
      </Stack>
    );
    switch (route.section) {
      case "terminal":
        return (
          <TerminalMock
            start={terminalStart}
            onOpenPayment={openPayment}
            onOpenSections={() => setRoute({ section: "history" })}
          />
        );
      case "history":
        return <HistoryMock tabBar={tabBar} onOpenPayment={openPayment} />;
      case "wallet":
        return <WalletMock tabBar={tabBar} />;
      case "settings":
        return <SettingsMock tabBar={tabBar} />;
    }
  };

  return (
    <PhoneFrame accessibilityLabel={accessibilityLabel} maxWidth={maxWidth}>
      {screen()}
    </PhoneFrame>
  );
}
