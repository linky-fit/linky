import type { AppScreenshot } from "../../prose";

const folder = "/blog/finding-contacts";
const guideFolder = "/blog/simple-guide";

export const cover = `${folder}/cover.jpg`;

/** Screenshots of the Czech app at 390×844, two device pixels per CSS pixel. */
const shot = (folder: string, name: string): AppScreenshot => ({
  src: `${folder}/${name}.png`,
  width: 780,
  height: 1688,
});

export const shots = {
  profileNfc: shot(folder, "profile-nfc"),
  nfcModal: shot(folder, "nfc-modal"),
  contactsNearby: shot(folder, "contacts-nearby"),
  beacon: shot(folder, "beacon"),
  beaconIntro: shot(folder, "beacon-intro"),
  chatContacts: shot(folder, "chat-contacts"),
  // Shared with the simple guide, so the two articles show the same screens.
  profile: shot(guideFolder, "profile"),
  contactNew: shot(guideFolder, "contact-new"),
  contactSearch: shot(guideFolder, "contact-new-search"),
};
