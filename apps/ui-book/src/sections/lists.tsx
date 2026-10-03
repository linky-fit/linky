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
          <UI.ListRow title="Remove example" destructive onPress={() => {}} />
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
            supporter="gold"
            preview={<UI.Pill label="120 sats" size="sm" />}
            onPress={() => setSelected(!selected)}
          />
        </UI.Stack>
      );
    },
  },
};
