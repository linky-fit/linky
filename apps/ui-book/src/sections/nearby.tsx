import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { sampleImage } from "../sample-image";

const sells: UI.NearbyBadge = { label: "Sells BTC", tone: "info" };
const buys: UI.NearbyBadge = { label: "Buys BTC", tone: "accent" };

const people: readonly {
  name: string;
  badge?: UI.NearbyBadge;
  imageUrl?: string;
}[] = [
  { name: "Bea Stone", badge: sells },
  { name: "Color Study", badge: buys, imageUrl: sampleImage },
  { name: "Cyril Novak", badge: { label: "New", tone: "neutral" } },
  { name: "Dana Kral" },
  { name: "Emil Horak" },
  { name: "Filip Dvorak" },
];

const firstName = (name: string) => name.split(" ")[0] ?? name;

export const nearby: Section = {
  title: "Nearby",
  entries: {
    NearbyAvatar: () => {
      const [pressed, setPressed] = useState("");
      return (
        <UI.Stack>
          <UI.Row alignItems="flex-start" flexWrap="wrap">
            <UI.NearbyAvatar
              name="Alex Rivers"
              label="You"
              isSelf
              badge={sells}
              onPress={() => setPressed("You")}
            />
            <UI.NearbyAvatar
              name="Bea Stone"
              label="Bea"
              badge={buys}
              onPress={() => setPressed("Bea")}
            />
            <UI.NearbyAvatar
              name="Cyril Novak"
              label="Cyril"
              badge={{ label: "New", tone: "neutral" }}
              onPress={() => setPressed("Cyril")}
            />
            <UI.NearbyAvatar
              name="Long localized badge"
              label="Maximilian"
              badge={{ label: "Prodává BTC", tone: "info" }}
              onPress={() => setPressed("Maximilian")}
            />
          </UI.Row>
          <UI.Text variant="caption" color="$colorMuted">
            {pressed ? `Pressed ${pressed}` : "Press an avatar"}
          </UI.Text>
        </UI.Stack>
      );
    },
    NearbyRow: () => (
      <UI.Section title="Nearby">
        <UI.NearbyRow accessibilityLabel="Nearby">
          <UI.NearbyAvatar
            name="Alex Rivers"
            label="You"
            isSelf
            badge={buys}
            onPress={() => {}}
          />
          {people.map(({ name, badge, imageUrl }) => (
            <UI.NearbyAvatar
              key={name}
              name={name}
              imageUrl={imageUrl}
              label={firstName(name)}
              badge={badge}
              onPress={() => {}}
            />
          ))}
        </UI.NearbyRow>
      </UI.Section>
    ),
    NearbyBanner: () => {
      const [pressed, setPressed] = useState(false);
      return (
        <UI.Stack marginHorizontal={-UI.space.xl}>
          <UI.NearbyBanner label="Nearby" />
          <UI.NearbyBanner
            label={pressed ? "Pressed" : "Nearby, buys BTC"}
            onPress={() => setPressed(!pressed)}
          />
        </UI.Stack>
      );
    },
  },
};
