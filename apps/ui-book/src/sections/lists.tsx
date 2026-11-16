import { useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";

export const lists: Section = {
  title: "Lists",
  entries: {
    ListRow: () => {
      const [enabled, setEnabled] = useState(true);
      const [expanded, setExpanded] = useState(false);
      return (
        <UI.Stack>
          <UI.ListRow
            title="Notifications"
            description="Messages and payment updates"
            icon="Bell"
            selected={enabled}
            onPress={() => setEnabled(!enabled)}
          />
          <UI.ListRow
            title="Display unit"
            icon="Coins"
            value="Sats"
            onPress={() => {}}
          />
          <UI.ListRow
            title="Payment details"
            meta="10:42"
            chevron={false}
            expanded={expanded}
            onPress={() => setExpanded(!expanded)}
          />
          {expanded ? (
            <UI.Text variant="caption" color="$colorMuted">
              Fee 2 sats, paid with the default mint.
            </UI.Text>
          ) : null}
          <UI.ListRow
            title="Cash"
            description="Swap bitcoin for cash in person"
            icon="Banknote"
            iconTone="warning"
            active
            onPress={() => {}}
          />
          <UI.ListRow title="Remove example" destructive onPress={() => {}} />
          <UI.ListRow
            leading={<UI.Avatar name="Alice" />}
            title="Alice"
            description={
              <UI.Row gap="$xs" alignItems="center">
                <UI.Text variant="caption" color="$colorMuted">
                  alice@linky.fit
                </UI.Text>
                <UI.Icon name="Check" size="sm" color="$accent" />
              </UI.Row>
            }
            chevron={false}
            onPress={() => {}}
            action={
              <UI.Row gap="$sm" alignItems="center">
                <UI.BrandMark size="icon" />
                <UI.Button icon="UserPlus" onPress={() => {}}>
                  Add
                </UI.Button>
              </UI.Row>
            }
          />
          <UI.ListRow
            leading={<UI.Avatar name="Bob" />}
            title="Bob"
            description="npub1bob…"
            chevron={false}
            onPress={() => {}}
            action={
              <UI.Row gap="$sm" alignItems="center">
                <UI.Icon name="Nostr" color="$colorMuted" />
                <UI.Button icon="UserPlus" onPress={() => {}}>
                  Add
                </UI.Button>
              </UI.Row>
            }
          />
        </UI.Stack>
      );
    },
    SwipeRow: () => {
      const [last, setLast] = useState("Swipe the row either way");
      return (
        <UI.Stack gap="$sm">
          <UI.SwipeRow
            swipeLeft={{
              icon: "EyeOff",
              label: "Hide",
              tone: "neutral",
              onTrigger: () => setLast("Hidden"),
            }}
            swipeRight={{
              icon: "Pin",
              label: "Pin",
              tone: "accent",
              onTrigger: () => setLast("Pinned"),
            }}
          >
            <UI.ListRow
              title="Homemade bread"
              description="per loaf"
              trailing={<UI.Text variant="label">120 Kč</UI.Text>}
              onPress={() => setLast("Opened")}
            />
          </UI.SwipeRow>
          <UI.SwipeRow
            swipeLeft={{
              icon: "Pause",
              label: "Pause",
              tone: "neutral",
              onTrigger: () => setLast("Paused"),
            }}
          >
            <UI.ListRow
              title="Bike repair"
              description="per hour"
              trailing={<UI.Text variant="label">300 Kč</UI.Text>}
              onPress={() => setLast("Opened")}
            />
          </UI.SwipeRow>
          <UI.Text variant="caption" color="$colorMuted">
            {last}
          </UI.Text>
        </UI.Stack>
      );
    },
    ContactRow: () => {
      const [selected, setSelected] = useState(false);
      return (
        <UI.Stack>
          <UI.ContactRow
            name="Alex Rivers"
            preview="See you on Saturday."
            time="10:42"
            unread
            selected={selected}
            onPress={() => setSelected(!selected)}
          />
          <UI.ContactRow
            name="Alex Rivers (2)"
            avatarName="Alex Rivers"
            status="On a hike"
            badge="unknown"
            preview={<UI.Pill label="120 sats" size="sm" />}
            onPress={() => setSelected(!selected)}
          />
          <UI.ContactRow
            name="Acme Inc."
            avatarIcon="Building"
            preview={
              <UI.Text variant="caption" mono color="$colorMuted">
                https://acme.example
              </UI.Text>
            }
            onPress={() => setSelected(!selected)}
          />
        </UI.Stack>
      );
    },
  },
};
