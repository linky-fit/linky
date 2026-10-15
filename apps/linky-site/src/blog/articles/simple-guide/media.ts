import type { AppScreenshot } from "../../prose";

const folder = "/blog/simple-guide";

export const cover = `${folder}/cover.jpg`;

/** Screenshots of the Czech app at 390×844, two device pixels per CSS pixel. */
const shot = (name: string): AppScreenshot => ({
  src: `${folder}/${name}.png`,
  width: 780,
  height: 1688,
});

export const shots = {
  welcome: shot("onboarding-welcome"),
  picture: shot("onboarding-picture"),
  restore: shot("onboarding-restore"),
  checklist: shot("contacts-checklist"),
  tutorial: shot("tutorial"),
  masterKeys: shot("master-keys"),
  profile: shot("profile"),
  contactNew: shot("contact-new"),
  contactSearch: shot("contact-new-search"),
  contactEdit: shot("contact-edit"),
  messageActions: shot("message-actions"),
  contactRequest: shot("contact-request"),
  topup: shot("topup"),
  topupInvoice: shot("topup-invoice"),
  topupNoAmount: shot("topup-no-amount"),
  send: shot("send-scan"),
  manualPay: shot("manual-pay"),
};
