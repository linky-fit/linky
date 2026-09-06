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

  return (
    <section className="panel panel-plain contacts-checklist">
      <div className="contacts-checklist-header">
        <div className="contacts-checklist-title">
          {t("contactsOnboardingTitle")}
        </div>
        <button
          type="button"
          className="contacts-checklist-close"
          onClick={dismissContactsOnboarding}
          aria-label={t("contactsOnboardingDismiss")}
          title={t("contactsOnboardingDismiss")}
        >
          ×
        </button>
      </div>

      <div className="contacts-checklist-progressRow">
        <div className="contacts-checklist-progress" aria-hidden="true">
          <div
            className="contacts-checklist-progressFill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="contacts-checklist-progressText">
          {t("contactsOnboardingProgress")
            .replace(/\{done\}/g, String(tasksCompleted))
            .replace(/\{total\}/g, String(tasksTotal))}
        </div>
      </div>

      {isComplete ? (
        <div className="contacts-checklist-done" role="status">
          <span className="contacts-checklist-doneIcon" aria-hidden="true">
            ✓
          </span>
          <span>
            <div className="contacts-checklist-doneTitle">
              {t("contactsOnboardingCompletedTitle")}
            </div>
            <div className="contacts-checklist-doneBody">
              {t("contactsOnboardingCompletedBody")}
            </div>
          </span>
        </div>
      ) : (
        <div className="contacts-checklist-items" role="list">
          {nextTask ? (
            <div
              key={nextTask.key}
              className="contacts-checklist-item"
              role="listitem"
            >
              <span
                className="contacts-checklist-check is-bullet"
                aria-hidden="true"
              >
                •
              </span>
              <span className="contacts-checklist-label">{nextTask.label}</span>

              <button
                type="button"
                className="contacts-checklist-how"
                onClick={() => onShowHow(nextTask.key)}
              >
                {t("contactsOnboardingShowHow")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
