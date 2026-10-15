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
      '[data-testid="profile-qr-button"]',
      "guideAddContactStep1Title",
      "guideAddContactStep1Body",
      "contacts",
    ),
    step(
      "add_contact_2",
      '[data-guide="profile-qr"]',
      "guideAddContactStep2Title",
      "guideAddContactStep2Body",
      "profile",
    ),
    step(
      "add_contact_3",
      '[data-guide="contact-add-button"]',
      "guideAddContactStep3Title",
      "guideAddContactStep3Body",
      "contacts",
    ),
    step(
      "add_contact_4",
      '[data-guide="scan-contact-button"]',
      "guideAddContactStep4Title",
      "guideAddContactStep4Body",
      "contactNew",
    ),
  ],
  topup: [
    step(
      "topup_1",
      '[data-testid="open-wallet"]',
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
    step(
      "topup_4",
      '[data-testid="topup-invoice-qr"]',
      "guideTopupStep4Title",
      "guideTopupStep4Body",
      "topupInvoice",
    ),
    step(
      "topup_5",
      '[data-guide="chat-request"]',
      "guideTopupStep5Title",
      "guideTopupStep5Body",
      "chat",
      true,
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
      '[data-guide="chat-pay"]',
      "guidePayStep2Title",
      "guidePayStep2Body",
      "chat",
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
    step(
      "pay_4",
      '[data-guide="wallet-send"]',
      "guidePayStep4Title",
      "guidePayStep4Body",
      "wallet",
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
      '[data-guide="chat-input"]',
      "guideMessageStep2Title",
      "guideMessageStep2Body",
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
  linky_name: [
    step(
      "linky_name_1",
      '[data-testid="profile-qr-button"]',
      "guideLinkyNameStep1Title",
      "guideLinkyNameStep1Body",
      "contacts",
    ),
    step(
      "linky_name_2",
      '[data-guide="profile-edit"]',
      "guideLinkyNameStep2Title",
      "guideLinkyNameStep2Body",
      "profile",
    ),
    step(
      "linky_name_3",
      '[data-guide="profile-ln-address"]',
      "guideLinkyNameStep3Title",
      "guideLinkyNameStep3Body",
      "profileEdit",
    ),
  ],
  groups: [
    step(
      "groups_1",
      '[data-guide="contact-card"]',
      "guideGroupsStep1Title",
      "guideGroupsStep1Body",
      "contacts",
    ),
    step(
      "groups_2",
      '[data-guide="contact-edit"]',
      "guideGroupsStep2Title",
      "guideGroupsStep2Body",
      "chat",
      true,
    ),
    step(
      "groups_3",
      '[data-guide="contact-group"]',
      "guideGroupsStep3Title",
      "guideGroupsStep3Body",
      "contactEdit",
      true,
    ),
    step(
      "groups_4",
      '[data-guide="chat-input"]',
      "guideGroupsStep4Title",
      "guideGroupsStep4Body",
      "chat",
      true,
    ),
  ],
  proxy_payment: [
    step(
      "proxy_payment_1",
      '[data-testid="open-proxy"]',
      "guideProxyPaymentStep1Title",
      "guideProxyPaymentStep1Body",
      "contacts",
    ),
    step(
      "proxy_payment_2",
      '[data-guide="proxy-scan"]',
      "guideProxyPaymentStep2Title",
      "guideProxyPaymentStep2Body",
      "proxyPayments",
    ),
    step(
      "proxy_payment_3",
      '[data-guide="proxy-earn"]',
      "guideProxyPaymentStep3Title",
      "guideProxyPaymentStep3Body",
      "proxyPayments",
    ),
  ],
  beacon: [
    step(
      "beacon_1",
      '[data-testid="open-proxy"]',
      "guideBeaconStep1Title",
      "guideBeaconStep1Body",
      "contacts",
    ),
    step(
      "beacon_2",
      '[data-guide="beacon-switch"]',
      "guideBeaconStep2Title",
      "guideBeaconStep2Body",
      "proxyPayments",
    ),
    step(
      "beacon_3",
      '[data-guide="beacon-trade"]',
      "guideBeaconStep3Title",
      "guideBeaconStep3Body",
      "proxyPayments",
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
