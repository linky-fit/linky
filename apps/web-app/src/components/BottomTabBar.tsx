import React from "react";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { BottomTab } from "./BottomTab";

interface BottomTabBarProps {
  activeTab: "contacts" | "wallet" | null;
  activeProgress?: number;
  contactsLabel: string;
  onTabChange?: (tab: "contacts" | "wallet") => void;
  t: Translate;
  walletLabel: string;
}

export function BottomTabBar({
  activeTab,
  activeProgress,
  contactsLabel,
  onTabChange,
  t,
  walletLabel,
}: BottomTabBarProps): React.ReactElement {
  const tabsRef = React.useRef<HTMLDivElement | null>(null);
  const contactsTabRef = React.useRef<HTMLButtonElement | null>(null);
  const walletTabRef = React.useRef<HTMLButtonElement | null>(null);
  const [tabMetrics, setTabMetrics] = React.useState<{
    contactsLeft: number;
    contactsWidth: number;
    walletLeft: number;
    walletWidth: number;
    ready: boolean;
  }>({
    contactsLeft: 0,
    contactsWidth: 0,
    walletLeft: 0,
    walletWidth: 0,
    ready: false,
  });

  const clampProgress = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
  };

  const progress =
    activeProgress !== undefined
      ? clampProgress(activeProgress)
      : activeTab === "wallet"
        ? 1
        : 0;
  const visualActiveTab: "contacts" | "wallet" | null =
    activeProgress !== undefined
      ? progress >= 0.5
        ? "wallet"
        : "contacts"
      : activeTab;

  const measureTabs = React.useCallback(() => {
    const container = tabsRef.current;
    const contacts = contactsTabRef.current;
    const wallet = walletTabRef.current;
    if (!container || !contacts || !wallet) return;
    const containerRect = container.getBoundingClientRect();
    const contactsRect = contacts.getBoundingClientRect();
    const walletRect = wallet.getBoundingClientRect();
    setTabMetrics({
      contactsLeft: contactsRect.left - containerRect.left,
      contactsWidth: contactsRect.width,
      walletLeft: walletRect.left - containerRect.left,
      walletWidth: walletRect.width,
      ready: true,
    });
  }, []);

  React.useLayoutEffect(() => {
    measureTabs();
  }, [measureTabs, contactsLabel, walletLabel]);

  React.useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const container = tabsRef.current;
    const contacts = contactsTabRef.current;
    const wallet = walletTabRef.current;
    if (!container || !contacts || !wallet) return;
    const observer = new ResizeObserver(() => {
      measureTabs();
    });
    observer.observe(container);
    observer.observe(contacts);
    observer.observe(wallet);
    return () => observer.disconnect();
  }, [measureTabs]);

  const indicatorLeft =
    tabMetrics.contactsLeft +
    (tabMetrics.walletLeft - tabMetrics.contactsLeft) * progress;
  const indicatorWidth =
    tabMetrics.contactsWidth +
    (tabMetrics.walletWidth - tabMetrics.contactsWidth) * progress;

  const handleTabChange = React.useCallback(
    (tab: "contacts" | "wallet") => {
      if (tab === activeTab) return;
      if (onTabChange) {
        onTabChange(tab);
        return;
      }
      navigateTo({ route: tab });
    },
    [activeTab, navigateTo, onTabChange],
  );

  return (
    <div className="contacts-qr-bar" role="region">
      <div className="bottom-tabs-bar" role="tablist" aria-label={t("list")}>
        <div
          className={["bottom-tabs", tabMetrics.ready ? null : "no-indicator"]
            .filter(Boolean)
            .join(" ")}
          ref={tabsRef}
        >
          <div
            className="bottom-tabs-indicator"
            aria-hidden="true"
            style={
              tabMetrics.ready
                ? {
                    transform: `translateX(${indicatorLeft}px)`,
                    width: `${indicatorWidth}px`,
                  }
                : undefined
            }
          />
          <BottomTab
            icon="contacts"
            label={contactsLabel}
            isActive={visualActiveTab === "contacts"}
            onClick={() => handleTabChange("contacts")}
            buttonRef={contactsTabRef}
          />
          <BottomTab
            icon="wallet"
            label={walletLabel}
            isActive={visualActiveTab === "wallet"}
            onClick={() => handleTabChange("wallet")}
            buttonRef={walletTabRef}
          />
        </div>
      </div>
      <div className="contacts-qr-inner"></div>
    </div>
  );
}
