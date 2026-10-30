import { PaymentBanner, Stack, TabBar } from "@linky-fit/ui";
import type { NavItem } from "@linky-fit/ui";
import { useCallback, useEffect, useState } from "react";
import { copy } from "../copy";
import { PhoneFrame } from "./chrome";
import { formatCrowns } from "./money";
import { HistoryMock } from "./screens/HistoryMock";
import { PaymentMock } from "./screens/PaymentMock";
import { SettingsMock } from "./screens/SettingsMock";
import { TerminalMock } from "./screens/TerminalMock";
import type { TerminalStart } from "./screens/TerminalMock";
import { WalletMock } from "./screens/WalletMock";
import type { DemoPayment } from "./store";

type Section = "terminal" | "history" | "wallet" | "settings";

type Route = { section: Section } | { paymentId: string };

const t = copy.demo;

/** How long the paid banner stays over the terminal, like the app's. */
export const PAID_BANNER_MS = 3_000;

const navItems: NavItem<Section>[] = [
  { value: "terminal", label: t.sections.terminal, icon: "QrCode" },
  { value: "history", label: t.sections.history, icon: "History" },
  { value: "wallet", label: t.sections.wallet, icon: "Bitcoin" },
  { value: "settings", label: t.sections.settings, icon: "Settings" },
];

const emptyTerminal: TerminalStart = { input: "", tipping: false };

/** The app with demo data in a phone: real UI components, working navigation. */
export function DemoApp({
  accessibilityLabel,
  maxWidth,
}: {
  accessibilityLabel: string;
  maxWidth: number;
}) {
  const [route, setRoute] = useState<Route>({ section: "terminal" });
  const [paid, setPaid] = useState<DemoPayment | null>(null);
  useEffect(() => {
    if (!paid) return;
    const timer = setTimeout(() => setPaid(null), PAID_BANNER_MS);
    return () => clearTimeout(timer);
  }, [paid]);

  const openPayment = useCallback(
    (paymentId: string) => setRoute({ paymentId }),
    [],
  );
  const toTerminal = useCallback(() => setRoute({ section: "terminal" }), []);
  // Like the app: a paid payment returns to the terminal, announced by the banner there.
  const onPaid = useCallback((payment: DemoPayment) => {
    setPaid(payment);
    setRoute({ section: "terminal" });
  }, []);

  const screen = () => {
    if ("paymentId" in route) {
      return (
        <PaymentMock
          paymentId={route.paymentId}
          onPaid={onPaid}
          onClose={toTerminal}
        />
      );
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
            start={emptyTerminal}
            banner={
              paid ? (
                <PaymentBanner
                  contained
                  title={t.payment.paidTitle}
                  amount={formatCrowns(paid.amountHalere)}
                  unit={t.czk}
                  direction="in"
                  avatar={paid.payer ?? undefined}
                  onDismiss={() => setPaid(null)}
                />
              ) : null
            }
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
