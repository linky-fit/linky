import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";

const navItems: readonly UI.NavItem[] = [
  { value: "contacts", label: "Contacts", icon: "Users" },
  { value: "wallet", label: "Wallet", icon: "Wallet" },
];

export const navigation: Section = {
  title: "Navigation",
  entries: {
    TopBar: () => (
      <UI.TopBar
        title="Wallet"
        leading={
          <UI.IconButton
            icon="ArrowLeft"
            accessibilityLabel="Example back"
            onPress={() => {}}
          />
        }
        trailing={
          <UI.IconButton
            icon="Settings"
            accessibilityLabel="Example settings"
            onPress={() => {}}
          />
        }
      />
    ),
    TabBar: () => {
      const [tab, setTab] = useState("contacts");
      return (
        <UI.TabBar
          accessibilityLabel="Example tabs"
          items={navItems}
          value={tab}
          onValueChange={setTab}
        />
      );
    },
    NavigationRail: () => {
      const [tab, setTab] = useState("contacts");
      return (
        <UI.NavigationRail
          accessibilityLabel="Example navigation rail"
          header={<UI.Avatar name="Alex Rivers" />}
          items={navItems}
          footerItems={[
            { value: "settings", label: "Settings", icon: "Settings" },
          ]}
          value={tab}
          onValueChange={setTab}
        />
      );
    },
  },
};
