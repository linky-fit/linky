import { language } from "../platform/language";
import { cs } from "./cs";
import { en } from "./en";

/** Every user-facing string, in the language the app started in. */
export const copy = { cs, en }[language];
