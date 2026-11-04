import {
  Button,
  IconButton,
  Notice,
  Progress,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";

interface OnboardingTask {
  done: boolean;
  key: string;
  label: string;
}

interface ContactsChecklistProps {
  contactsOnboardingCelebrating: boolean;
  dismissContactsOnboarding: () => void;
  onShowHow: (taskKey: string) => void;
  progressPercent: number;
  t: Translate;
  tasks: readonly OnboardingTask[];
  tasksCompleted: number;
  tasksTotal: number;
}

export function ContactsChecklist({
  contactsOnboardingCelebrating,
  dismissContactsOnboarding,
  onShowHow,
  progressPercent,
  t,
  tasks,
  tasksCompleted,
  tasksTotal,
}: ContactsChecklistProps): React.ReactElement {
  const isComplete =
    contactsOnboardingCelebrating || tasksCompleted === tasksTotal;
  const nextTask = tasks.find((task) => !task.done);
  const progressText = t("contactsOnboardingProgress")
    .replace(/\{done\}/g, String(tasksCompleted))
    .replace(/\{total\}/g, String(tasksTotal));

  return (
    <Stack
      gap="$sm"
      marginVertical="$sm"
      padding="$md"
      borderRadius="$card"
      backgroundColor="$surface"
    >
      <Row gap="$sm">
        <Text flex={1} variant="label" bold color="$colorSubtle">
          {t("contactsOnboardingTitle")}
        </Text>
        <Text variant="caption" bold color="$colorMuted">
          {progressText}
        </Text>
        <IconButton
          icon="X"
          size="sm"
          accessibilityLabel={t("contactsOnboardingDismiss")}
          onPress={dismissContactsOnboarding}
        />
      </Row>

      <Progress
        value={progressPercent}
        max={100}
        accessibilityLabel={progressText}
      />

      {isComplete ? (
        <Notice
          tone="accent"
          title={t("contactsOnboardingCompletedTitle")}
          description={t("contactsOnboardingCompletedBody")}
        />
      ) : nextTask ? (
        <Row gap="$sm">
          <Text flex={1} bold>
            {nextTask.label}
          </Text>
          <Button size="sm" onPress={() => onShowHow(nextTask.key)}>
            {t("contactsOnboardingShowHow")}
          </Button>
        </Row>
      ) : null}
    </Stack>
  );
}
