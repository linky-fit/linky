import { controls } from "./controls";
import { display } from "./display";
import { feedback } from "./feedback";
import { fields } from "./fields";
import { layout } from "./layout";
import { lists } from "./lists";
import { media } from "./media";
import { messaging } from "./messaging";
import { navigation } from "./navigation";
import { nearby } from "./nearby";
import { overlays } from "./overlays";
import { payments } from "./payments";
import { setup } from "./setup";

export { tokens } from "./tokens";

/** Every section whose entries are named after a public component. */
export const componentSections = [
  setup,
  layout,
  controls,
  fields,
  display,
  lists,
  nearby,
  feedback,
  overlays,
  navigation,
  payments,
  messaging,
  media,
];
