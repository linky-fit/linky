import {
  Button,
  Icon,
  ListRow,
  Progress,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
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
  listings: "Package",
  message: "MessageCircleMore",
  pay: "HandCoins",
  proxy_payment: "Landmark",
  support: "HeartHandshake",
  topup: "ArrowDownRight",
};

/** The getting-started tasks, replayable at any time. */
export function TutorialPage(): React.ReactElement {
  const { t } = useTranslation();
  const { contactsOnboardingTasks } = useContactsOnboarding();
  const startContactsGuide = useStartContactsGuide();
  const nextTaskKey = contactsOnboardingTasks.tasks.find(
    (task) => !task.done,
  )?.key;
  const progressText = t("contactsOnboardingProgress")
    .replace(/\{done\}/g, String(contactsOnboardingTasks.done))
    .replace(/\{total\}/g, String(contactsOnboardingTasks.total));

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{t("tutorialIntro")}</Text>

      <Stack gap="$sm">
        <Text variant="caption" bold color="$colorMuted">
          {progressText}
        </Text>
        <Progress
          value={contactsOnboardingTasks.percent}
          max={100}
          accessibilityLabel={progressText}
        />
      </Stack>

      <Section grouped>
        {contactsOnboardingTasks.tasks.map((task) => (
          <ListRow
            key={task.key}
            leading={
              task.done ? (
                <Icon name="CircleCheck" size="sm" color="$accent" />
              ) : (
                <Icon
                  name={TASK_ICONS[task.key]}
                  size="sm"
                  color="$colorMuted"
                />
              )
            }
            title={task.label}
            testID={`tutorial-task-${task.key}`}
            trailing={
              <Button
                size="sm"
                variant={
                  task.key === nextTaskKey
                    ? "primary"
                    : task.done
                      ? "ghost"
                      : "secondary"
                }
                onPress={() => startContactsGuide(task.key, task.done)}
              >
                {t("contactsOnboardingShowHow")}
              </Button>
            }
          />
        ))}
      </Section>
    </Stack>
  );
}
