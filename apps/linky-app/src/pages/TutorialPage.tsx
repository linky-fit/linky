import { Button, ListRow, Progress, Row, Stack, Text } from "@linky-fit/ui";
import type { IconName } from "@linky-fit/ui";
import React from "react";
import { useStartContactsGuide } from "../app/hooks/guide/useContactsGuideControls";
import { useContactsOnboarding } from "../app/hooks/guide/useContactsOnboarding";
import { useTranslation } from "../app/hooks/shell";
import type { ContactsGuideKey } from "../app/types/appTypes";

const TASK_ICONS: Record<ContactsGuideKey, IconName> = {
  add_contact: "UserPlus",
  backup_keys: "ShieldCheck",
  beacon: "Radio",
  groups: "Users",
  linky_name: "Zap",
  message: "MessageCircleMore",
  pay: "HandCoins",
  proxy_payment: "Landmark",
  topup: "ArrowDownRight",
};

/** The getting-started tasks, replayable at any time. */
export function TutorialPage(): React.ReactElement {
  const { t } = useTranslation();
  const { contactsOnboardingTasks } = useContactsOnboarding();
  const startContactsGuide = useStartContactsGuide();
  const progressText = t("contactsOnboardingProgress")
    .replace(/\{done\}/g, String(contactsOnboardingTasks.done))
    .replace(/\{total\}/g, String(contactsOnboardingTasks.total));

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{t("tutorialIntro")}</Text>

      <Row gap="$sm">
        <Stack flex={1}>
          <Progress
            value={contactsOnboardingTasks.percent}
            max={100}
            accessibilityLabel={progressText}
          />
        </Stack>
        <Text variant="caption" bold color="$colorMuted">
          {progressText}
        </Text>
      </Row>

      <Stack>
        {contactsOnboardingTasks.tasks.map((task) => (
          <ListRow
            key={task.key}
            icon={TASK_ICONS[task.key]}
            title={task.label}
            testID={`tutorial-task-${task.key}`}
            trailing={
              <Button
                size="sm"
                variant={task.done ? "secondary" : "primary"}
                onPress={() => startContactsGuide(task.key, task.done)}
              >
                {t("contactsOnboardingShowHow")}
              </Button>
            }
          />
        ))}
      </Stack>
    </Stack>
  );
}
