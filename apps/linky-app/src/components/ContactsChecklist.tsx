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
    <Stack gap="$sm" paddingVertical="$md">
      <Row justifyContent="space-between">
        <Text variant="label" bold color="$colorSubtle">
          {t("contactsOnboardingTitle")}
        </Text>
        <IconButton
          icon="X"
          size="sm"
          accessibilityLabel={t("contactsOnboardingDismiss")}
          onPress={dismissContactsOnboarding}
        />
      </Row>

      <Row gap="$sm">
        <Stack flex={1}>
          <Progress
            value={progressPercent}
            max={100}
            accessibilityLabel={progressText}
          />
        </Stack>
        <Text variant="caption" bold color="$colorMuted">
          {progressText}
        </Text>
      </Row>

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
          <Button
            size="sm"
            variant="accent"
            onPress={() => onShowHow(nextTask.key)}
          >
            {t("contactsOnboardingShowHow")}
          </Button>
        </Row>
      ) : null}
    </Stack>
  );
}
