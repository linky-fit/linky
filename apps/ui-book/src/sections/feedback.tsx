import { useEffect, useState } from "react";
import * as UI from "@linky-fit/ui";
import type { Section } from "../section";
import { tones } from "../sample-data";

const COUNTDOWN_SEC = 10;

export const feedback: Section = {
  title: "Feedback",
  entries: {
    Notice: () => (
      <UI.Stack>
        {tones.map((tone) => (
          <UI.Notice
            key={tone}
            title={`${tone} notice`}
            description="A short explanation."
            tone={tone}
          />
        ))}
        <UI.Notice
          solid
          icon="RefreshCcw"
          title="A new version is available"
          action={{ label: "Update", onPress: () => {} }}
        />
      </UI.Stack>
    ),
    Toast: () => {
      const [undone, setUndone] = useState(false);
      return (
        <UI.Toast
          title={undone ? "Undone" : "Contact saved"}
          action={{ label: "Undo", onPress: () => setUndone(!undone) }}
        />
      );
    },
    ToastStack: () => (
      <UI.Stack
        position="relative"
        height="$hero"
        backgroundColor="$background"
        borderRadius="$card"
      >
        <UI.Text variant="caption">
          Toasts at the top of their container
        </UI.Text>
        <UI.ToastStack>
          <UI.Toast title="Saved locally" />
        </UI.ToastStack>
      </UI.Stack>
    ),
    Spinner: () => (
      <UI.Row>
        <UI.Spinner accessibilityLabel="Small spinner" />
        <UI.Spinner size="lg" accessibilityLabel="Large spinner" />
        <UI.Spinner
          size="lg"
          color="$warning"
          accessibilityLabel="Warning spinner"
        />
      </UI.Row>
    ),
    LoadingState: () => <UI.LoadingState label="Loading contacts" />,
    StatusLine: () => (
      <UI.Stack>
        <UI.StatusLine busy label="Waiting for the Evolu relay." />
        <UI.StatusLine rounded label="Synced a moment ago." />
      </UI.Stack>
    ),
    Progress: () => {
      // Ticks once a second like the app's payment countdown; the fill glides between ticks.
      const [elapsed, setElapsed] = useState(0);
      useEffect(() => {
        const interval = setInterval(
          () => setElapsed((value) => (value + 1) % (COUNTDOWN_SEC + 1)),
          1000,
        );
        return () => clearInterval(interval);
      }, []);
      return (
        <UI.Stack>
          <UI.Progress value={0.4} accessibilityLabel="Progress 40 percent" />
          <UI.Progress value={1} tone="info" accessibilityLabel="Complete" />
          <UI.Progress
            value={2}
            max={3}
            segments={3}
            accessibilityLabel="Step 2 of 3"
          />
          <UI.Progress
            value={elapsed + 1}
            max={COUNTDOWN_SEC}
            transition="countdown"
            accessibilityLabel={`Pays in ${COUNTDOWN_SEC - elapsed} seconds`}
          />
        </UI.Stack>
      );
    },
    EmptyState: () => (
      <UI.EmptyState
        icon="Users"
        title="No contacts yet"
        description="Add your first contact."
        action={<UI.Button size="sm">Add contact</UI.Button>}
      />
    ),
  },
};
