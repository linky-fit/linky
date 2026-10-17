// Hermes has Promise.withResolvers and the Set methods; core-js's Promise
// polyfill would replace Hermes' Promise and recurse.
import "core-js/actual/array/to-sorted";
// Hermes has no Intl.RelativeTimeFormat; each polyfill installs only what is missing.
import "@formatjs/intl-locale/polyfill.js";
import "@formatjs/intl-pluralrules/polyfill.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/cs.js";
import "@formatjs/intl-pluralrules/locale-data/de.js";
import "@formatjs/intl-pluralrules/locale-data/pt.js";
import "@formatjs/intl-relativetimeformat/polyfill.js";
import "@formatjs/intl-relativetimeformat/locale-data/en.js";
import "@formatjs/intl-relativetimeformat/locale-data/cs.js";
import "@formatjs/intl-relativetimeformat/locale-data/de.js";
import "@formatjs/intl-relativetimeformat/locale-data/pt.js";
