import { install } from "react-native-quick-crypto";

// Hermes has no Web Crypto, and uncrypto (via slip39-ts) reads globalThis.crypto.subtle when it loads.
install();
