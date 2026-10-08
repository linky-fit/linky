import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { sampleImage } from "../sample-image";

const people: readonly {
  name: string;
  trade?: UI.NearbyTrade;
  imageUrl?: string;
}[] = [
  { name: "Bea Stone", trade: "sell" },
  { name: "Color Study", trade: "buy", imageUrl: sampleImage },
  { name: "Cyril Novak" },
  { name: "Dana Kral" },
  { name: "Emil Horak" },
  { name: "Filip Dvorak" },
];

const badgeLabels = { buy: "Buys BTC", sell: "Sells BTC" };

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
              trade="sell"
              badgeLabel="Sells BTC"
              onPress={() => setPressed("You")}
            />
            <UI.NearbyAvatar
              name="Bea Stone"
              label="Bea"
              trade="buy"
              badgeLabel="Buys BTC"
              onPress={() => setPressed("Bea")}
            />
            <UI.NearbyAvatar
              name="Cyril Novak"
              label="Cyril"
              onPress={() => setPressed("Cyril")}
            />
            <UI.NearbyAvatar
              name="Long localized badge"
              label="Maximilian"
              trade="sell"
              badgeLabel="Prodává BTC"
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
            trade="buy"
            badgeLabel="Buys BTC"
            onPress={() => {}}
          />
          {people.map(({ name, trade, imageUrl }) => (
            <UI.NearbyAvatar
              key={name}
              name={name}
              imageUrl={imageUrl}
              label={firstName(name)}
              onPress={() => {}}
              {...(trade ? { trade, badgeLabel: badgeLabels[trade] } : {})}
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
