import type { I18nKey } from "../../i18n";
import type { Route } from "../../types/route";
import type { ContactsGuideKey } from "../types/appTypes";

export interface ContactsGuideStepView {
  readonly bodyKey: I18nKey;
  readonly id: string;
  /** The screen the step happens on. */
  readonly route: Route["kind"];
  readonly selector: string;
  /** The step's screen shows the contact the walkthrough leads to. */
  readonly showsTarget: boolean;
  readonly titleKey: I18nKey;
}

const step = (
  id: string,
  selector: string,
  titleKey: I18nKey,
  bodyKey: I18nKey,
  route: Route["kind"],
  showsTarget = false,
): ContactsGuideStepView => ({
  bodyKey,
  id,
  route,
  selector,
  showsTarget,
  titleKey,
});

/** Each walkthrough's steps, in order. */
export const CONTACTS_GUIDE_STEPS: Record<
  ContactsGuideKey,
  readonly ContactsGuideStepView[]
> = {
  add_contact: [
    step(
      "add_contact_1",
      '[data-guide="contact-add-button"]',
      "guideAddContactStep1Title",
      "guideAddContactStep1Body",
      "contacts",
    ),
    step(
      "add_contact_2",
      '[data-guide="contact-search-input"]',
      "guideAddContactStep2Title",
      "guideAddContactStep2Body",
      "contactNew",
    ),
  ],
  topup: [
    step(
      "topup_1",
      '[data-guide="open-wallet"]',
      "guideTopupStep1Title",
      "guideTopupStep1Body",
      "contacts",
    ),
    step(
      "topup_2",
      '[data-guide="wallet-topup"]',
      "guideTopupStep2Title",
      "guideTopupStep2Body",
      "wallet",
    ),
    step(
      "topup_3",
      '[data-guide="topup-show-invoice"]',
      "guideTopupStep3Title",
      "guideTopupStep3Body",
      "topup",
    ),
  ],
  pay: [
    step(
      "pay_1",
      '[data-guide="contact-card"]',
      "guidePayStep1Title",
      "guidePayStep1Body",
      "contacts",
    ),
    step(
      "pay_2",
      '[data-guide="contact-pay"]',
      "guidePayStep2Title",
      "guidePayStep2Body",
      "contact",
      true,
    ),
    step(
      "pay_3",
      '[data-guide="pay-step3"]',
      "guidePayStep3Title",
      "guidePayStep3Body",
      "contactPay",
      true,
    ),
  ],
  message: [
    step(
      "message_1",
      '[data-guide="contact-card"]',
      "guideMessageStep1Title",
      "guideMessageStep1Body",
      "contacts",
    ),
    step(
      "message_2",
      '[data-guide="contact-message"]',
      "guideMessageStep2Title",
      "guideMessageStep2Body",
      "contact",
      true,
    ),
    step(
      "message_3",
      '[data-guide="chat-input"]',
      "guideMessageStep3Title",
      "guideMessageStep3Body",
      "chat",
      true,
    ),
    step(
      "message_4",
      '[data-guide="chat-send"]',
      "guideMessageStep4Title",
      "guideMessageStep4Body",
      "chat",
      true,
    ),
  ],
  backup_keys: [
    step(
      "backup_keys_1",
      '[data-testid="open-menu"]',
      "guideBackupKeysStep1Title",
      "guideBackupKeysStep1Body",
      "contacts",
    ),
    step(
      "backup_keys_2",
      '[data-testid="open-master-keys"]',
      "guideBackupKeysStep2Title",
      "guideBackupKeysStep2Body",
      "settings",
    ),
    step(
      "backup_keys_3",
      '[data-guide="copy-seed"]',
      "guideBackupKeysStep3Title",
      "guideBackupKeysStep3Body",
      "settingsMasterKeys",
    ),
  ],
};

export interface ActiveContactsGuideStep {
  readonly idx: number;
  readonly step: ContactsGuideStepView | null;
  readonly total: number;
}

/** The walkthrough step `guide` points at, clamped to its steps. */
export const activeContactsGuideStep = (
  guide: { readonly step: number; readonly task: ContactsGuideKey } | null,
): ActiveContactsGuideStep | null => {
  if (!guide) return null;
  const steps = CONTACTS_GUIDE_STEPS[guide.task];
  const idx = Math.min(Math.max(guide.step, 0), Math.max(steps.length - 1, 0));
  return { idx, step: steps[idx] ?? null, total: steps.length };
};
