import {
  decode as decodePayBySquare,
  encode as encodePayBySquare,
  PaymentOptions,
} from "bysquare/pay";
import {
  getDomesticBankAccountCountry,
  isValidBic,
  normalizeBankAccountInput,
} from "./bankAccount";

export type BankPaymentFormat = "bysquare" | "epc" | "payme" | "pix" | "spd";

export interface BankPayment {
  fields: Record<string, string>;
  format: BankPaymentFormat;
  payload: string;
}

interface SpdPayment extends BankPayment {
  format: "spd";
}

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isSpdPaymentPayload = (input: string): boolean =>
  input.trim().startsWith("SPD*");

export const parseSpdPayment = (input: string): SpdPayment => {
  const payload = input.trim();
  const parts = payload.split("*").filter(Boolean);

  if (parts[0] !== "SPD") {
    throw new Error("spd-not-spd");
  }

  const fields: Record<string, string> = {};
  for (const part of parts.slice(2)) {
    const index = part.indexOf(":");
    if (index < 1) continue;

    const key = part.slice(0, index).toUpperCase();
    const value = safeDecodeURIComponent(part.slice(index + 1));
    fields[key] = value;
  }

  // SPD carries the BIC inside ACC as `IBAN+BIC`; keep it as its own field so
  // every format exposes the same shape.
  const [iban = "", bic = ""] = (fields["ACC"] ?? "").split("+");
  if (iban.trim()) fields["ACC"] = iban.trim();
  else delete fields["ACC"];
  if (bic.trim() && !fields["BIC"]) fields["BIC"] = bic.trim();

  if (!fields["ACC"]) {
    throw new Error("spd-missing-account");
  }

  return { payload, fields, format: "spd" };
};

const createBankPayment = (args: {
  fields: Record<string, number | string | null | undefined>;
  format: Exclude<BankPaymentFormat, "spd">;
  payload: string;
}): BankPayment => {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(args.fields)) {
    const normalized = String(value ?? "").trim();
    if (normalized) fields[key] = normalized;
  }

  if (!(fields["ACC"] ?? "").trim()) {
    throw new Error("spd-missing-account");
  }

  return { fields, format: args.format, payload: args.payload };
};

const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

const parseEpcPayment = (input: string): BankPayment => {
  const payload = input.trim();
  const lines = payload.replace(/\r\n/g, "\n").split("\n");
  if (
    lines[0] !== "BCD" ||
    (lines[1] !== "001" && lines[1] !== "002") ||
    lines[3] !== "SCT"
  ) {
    throw new Error("bank-payment-invalid-epc");
  }

  const account = (lines[6] ?? "").replace(/\s/g, "").toUpperCase();
  if (!IBAN_PATTERN.test(account)) throw new Error("spd-missing-account");

  const amountAndCurrency = (lines[7] ?? "").trim().toUpperCase();
  const amountMatch = /^EUR(\d+(?:\.\d{1,2})?)?$/.exec(amountAndCurrency);
  if (!amountMatch) throw new Error("bank-payment-invalid-epc-amount");

  return createBankPayment({
    fields: {
      ACC: account,
      AM: amountMatch[1],
      BIC: lines[4],
      CC: "EUR",
      MSG: lines[10],
      RF: lines[9],
      RN: lines[5],
    },
    format: "epc",
    payload,
  });
};

const BYSQUARE_PAYLOAD_PATTERN = /^[0-9A-V]{16,4096}$/;

const parsePayBySquarePayment = (input: string): BankPayment => {
  const payload = input.trim();
  if (!BYSQUARE_PAYLOAD_PATTERN.test(payload)) {
    throw new Error("bank-payment-invalid-bysquare");
  }

  const model = decodePayBySquare(payload);
  const payment = model.payments[0];
  if (!payment || payment.type !== PaymentOptions.PaymentOrder) {
    throw new Error("bank-payment-unsupported-bysquare-type");
  }

  const account = payment.bankAccounts[0];
  return createBankPayment({
    fields: {
      ACC: account?.iban,
      AM: payment.amount,
      BIC: account?.bic,
      CC: payment.currencyCode,
      DT: payment.paymentDueDate,
      MSG: payment.paymentNote,
      RF: payment.originatorsReferenceInformation,
      RN: payment.beneficiary.name,
      "X-KS": payment.constantSymbol,
      "X-SS": payment.specificSymbol,
      "X-VS": payment.variableSymbol,
    },
    format: "bysquare",
    payload,
  });
};

// Slovak Banking Association payment link (payme.sk). Version 1 is
// `https://payme.sk?V=1&…`; version 2 moves the version into the path as
// `/2/{m|e|q|p}/PME`, where the type letter decides which attributes are
// mandatory. Only the attributes are validated here; what the type requires
// is the bank app's business.
const PAYME_HOSTS = new Set(["payme.sk", "www.payme.sk"]);
const PAYME_V2_PATH_PATTERN = /^\/2\/[meqp]\/PME\/?$/i;
const PAYME_SYMBOLS_PATTERN = /^\/VS(\d{0,10})\/SS(\d{0,10})\/KS(\d{0,4})$/i;

const parsePaymeUrl = (payload: string): URL | null => {
  if (!/^https?:\/\//i.test(payload)) return null;
  let url: URL;
  try {
    url = new URL(payload);
  } catch {
    return null;
  }
  if (!PAYME_HOSTS.has(url.hostname)) return null;
  const isV2 = PAYME_V2_PATH_PATTERN.test(url.pathname);
  const isV1 = url.pathname === "/" && url.searchParams.get("V") === "1";
  return isV2 || isV1 ? url : null;
};

const isPaymePayload = (payload: string): boolean =>
  parsePaymeUrl(payload) !== null;

// Query parameter names are matched case-insensitively because QR scanners
// return byte-mode payloads in whatever case they were encoded.
const getPaymeAttributes = (url: URL): Record<string, string> => {
  const attributes: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    attributes[key.toUpperCase()] = value;
  }
  return attributes;
};

const parsePaymePayment = (input: string): BankPayment => {
  const payload = input.trim();
  const url = parsePaymeUrl(payload);
  if (!url) throw new Error("bank-payment-invalid-payme");
  const attributes = getPaymeAttributes(url);

  const account = (attributes["IBAN"] ?? "").replace(/\s/g, "").toUpperCase();
  if (!IBAN_PATTERN.test(account)) throw new Error("spd-missing-account");

  const amount = (attributes["AM"] ?? "").trim();
  if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new Error("bank-payment-invalid-amount");
  }

  // The Slovak symbols travel inside PI as `/VS…/SS…/KS…`; any other PI is
  // the plain end-to-end reference.
  const reference = (attributes["PI"] ?? "").trim();
  const symbols = PAYME_SYMBOLS_PATTERN.exec(reference);

  // The standard supports SEPA only, so a missing currency means EUR.
  return createBankPayment({
    fields: {
      ACC: account,
      AM: amount,
      CC: (attributes["CC"] ?? "").trim().toUpperCase() || "EUR",
      DT: attributes["DT"],
      MSG: attributes["MSG"],
      RF: symbols ? undefined : reference,
      RN: attributes["CN"],
      "X-KS": symbols?.[3],
      "X-SS": symbols?.[2],
      "X-VS": symbols?.[1],
    },
    format: "payme",
    payload,
  });
};

// Brazilian Pix "BR Code": an EMV QRCPS-MPM string of `id(2) length(2) value`
// tags, closed by a CRC16 over everything before the CRC's own value. The
// merchant account tag (26 to 51) whose first subtag is the Pix GUI carries
// the Pix key (static) or the payload URL (dynamic) plus a description.
interface EmvTag {
  id: string;
  value: string;
}

const PIX_GUI = "br.gov.bcb.pix";
const PIX_CURRENCY_CODE = "986";
const PIX_TXID_PATTERN = /^[A-Za-z0-9]{1,25}$/;
const PIX_EMPTY_TXID = "***";
const PIX_RECIPIENT_MAX_LENGTH = 25;
const PIX_CITY_MAX_LENGTH = 15;
const PIX_KEY_MAX_LENGTH = 77;
const EMV_VALUE_MAX_LENGTH = 99;

const parseEmvTags = (payload: string): EmvTag[] | null => {
  const tags: EmvTag[] = [];
  let index = 0;
  while (index < payload.length) {
    const header = payload.slice(index, index + 4);
    if (!/^\d{4}$/.test(header)) return null;
    const length = Number(header.slice(2));
    const value = payload.slice(index + 4, index + 4 + length);
    if (value.length !== length) return null;
    tags.push({ id: header.slice(0, 2), value });
    index += 4 + length;
  }
  return tags;
};

const serializeEmvTags = (tags: readonly EmvTag[]): string =>
  tags
    .map(({ id, value }) => {
      if (value.length > EMV_VALUE_MAX_LENGTH) {
        throw new Error("bank-payment-invalid-pix");
      }
      return `${id}${String(value.length).padStart(2, "0")}${value}`;
    })
    .join("");

// CRC-16/CCITT-FALSE (polynomial 0x1021, initial 0xFFFF) over the UTF-8
// bytes, as the EMV specification defines it.
const crc16Ccitt = (text: string): string => {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = ((crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff) >>> 0;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};

const isPixMerchantAccountTag = (tag: EmvTag): boolean => {
  const id = Number(tag.id);
  if (id < 26 || id > 51) return false;
  const gui = parseEmvTags(tag.value)?.find((subtag) => subtag.id === "00");
  return gui?.value.toLowerCase() === PIX_GUI;
};

const isPixPayload = (payload: string): boolean =>
  payload.startsWith("000201") && /br\.gov\.bcb\.pix/i.test(payload);

interface PixTags {
  account: EmvTag[];
  tags: EmvTag[];
}

const parsePixTags = (payload: string): PixTags => {
  const tags = isPixPayload(payload) ? parseEmvTags(payload) : null;
  if (!tags) throw new Error("bank-payment-invalid-pix");

  const crc = tags[tags.length - 1];
  if (crc?.id !== "63" || !/^[0-9A-Fa-f]{4}$/.test(crc.value)) {
    throw new Error("bank-payment-invalid-pix");
  }
  if (crc16Ccitt(payload.slice(0, -4)) !== crc.value.toUpperCase()) {
    throw new Error("bank-payment-invalid-pix-crc");
  }

  const accountTag = tags.find(isPixMerchantAccountTag);
  const account = accountTag ? parseEmvTags(accountTag.value) : null;
  if (!account) throw new Error("bank-payment-invalid-pix");

  const currency = tags.find((tag) => tag.id === "53")?.value;
  const country = tags.find((tag) => tag.id === "58")?.value.toUpperCase();
  if (
    (currency !== undefined && currency !== PIX_CURRENCY_CODE) ||
    (country !== undefined && country !== "BR")
  ) {
    throw new Error("bank-payment-invalid-pix");
  }

  return { account, tags };
};

const getEmvTagValue = (tags: readonly EmvTag[], id: string): string =>
  tags.find((tag) => tag.id === id)?.value ?? "";

const parsePixPayment = (input: string): BankPayment => {
  const payload = input.trim();
  const { account, tags } = parsePixTags(payload);

  const amount = getEmvTagValue(tags, "54");
  if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) {
    throw new Error("bank-payment-invalid-amount");
  }

  // A dynamic Pix carries the payload URL instead of a key; the bank app
  // resolves it, so the URL is what identifies where the money goes.
  const reference = getEmvTagValue(
    parseEmvTags(getEmvTagValue(tags, "62")) ?? [],
    "05",
  );
  return createBankPayment({
    fields: {
      ACC: getEmvTagValue(account, "25") || getEmvTagValue(account, "01"),
      AM: amount,
      CC: "BRL",
      CITY: getEmvTagValue(tags, "60"),
      MSG: getEmvTagValue(account, "02"),
      RF: reference === PIX_EMPTY_TXID ? undefined : reference,
      RN: getEmvTagValue(tags, "59"),
    },
    format: "pix",
    payload,
  });
};

export const parseBankPayment = (input: string): BankPayment => {
  const payload = input.trim();
  if (isSpdPaymentPayload(payload)) return parseSpdPayment(payload);
  if (payload.replace(/\r\n/g, "\n").startsWith("BCD\n")) {
    return parseEpcPayment(payload);
  }
  if (isPaymePayload(payload)) return parsePaymePayment(payload);
  if (isPixPayload(payload)) return parsePixPayment(payload);
  if (BYSQUARE_PAYLOAD_PATTERN.test(payload)) {
    return parsePayBySquarePayment(payload);
  }
  throw new Error("bank-payment-unsupported");
};

export const tryParseBankPayment = (input: string): BankPayment | null => {
  try {
    return parseBankPayment(input);
  } catch {
    return null;
  }
};

export const isBankPaymentPayload = (input: string): boolean => {
  const payload = input.trim();
  if (isSpdPaymentPayload(payload)) return true;
  if (payload.replace(/\r\n/g, "\n").startsWith("BCD\n")) return true;
  if (isPaymePayload(payload)) return true;
  return (
    (isPixPayload(payload) || BYSQUARE_PAYLOAD_PATTERN.test(payload)) &&
    tryParseBankPayment(payload) !== null
  );
};

export const BANK_PAYMENT_OFFER_CURRENCIES = ["CZK", "EUR", "BRL"] as const;

export type BankPaymentOfferCurrency =
  (typeof BANK_PAYMENT_OFFER_CURRENCIES)[number];

export const isBankPaymentOfferCurrency = (
  value: string,
): value is BankPaymentOfferCurrency =>
  BANK_PAYMENT_OFFER_CURRENCIES.some((currency) => currency === value);

export const getBankPaymentOfferCurrency = (
  input: string,
): BankPaymentOfferCurrency | null => {
  const currency = (
    tryParseBankPayment(input)?.fields["CC"] ?? ""
  ).toUpperCase();
  return isBankPaymentOfferCurrency(currency) ? currency : null;
};

export type BankPaymentFieldKey =
  | "ACC"
  | "AM"
  | "BIC"
  | "CITY"
  | "DT"
  | "MSG"
  | "RF"
  | "RN"
  | "X-KS"
  | "X-SS"
  | "X-VS";

const SPD_EDITABLE_FIELD_KEYS: readonly BankPaymentFieldKey[] = [
  "RN",
  "ACC",
  "BIC",
  "RF",
  "X-VS",
  "X-SS",
  "X-KS",
  "MSG",
  "DT",
];

const EPC_EDITABLE_FIELD_KEYS: readonly BankPaymentFieldKey[] = [
  "RN",
  "ACC",
  "BIC",
  "RF",
  "MSG",
];

const PAYME_EDITABLE_FIELD_KEYS: readonly BankPaymentFieldKey[] = [
  "RN",
  "ACC",
  "RF",
  "X-VS",
  "X-SS",
  "X-KS",
  "MSG",
  "DT",
];

const PIX_EDITABLE_FIELD_KEYS: readonly BankPaymentFieldKey[] = [
  "RN",
  "CITY",
  "ACC",
  "RF",
  "MSG",
];

// Pix needs no account tag until the key is typed, so this parses only once
// the form is filled in; the GUI, currency, country and empty txid are fixed.
const BLANK_PIX_PAYLOAD = (() => {
  const body = serializeEmvTags([
    { id: "00", value: "01" },
    { id: "26", value: serializeEmvTags([{ id: "00", value: PIX_GUI }]) },
    { id: "52", value: "0000" },
    { id: "53", value: PIX_CURRENCY_CODE },
    { id: "58", value: "BR" },
    {
      id: "62",
      value: serializeEmvTags([{ id: "05", value: PIX_EMPTY_TXID }]),
    },
  ]);
  return `${body}6304${crc16Ccitt(`${body}6304`)}`;
})();

/**
 * The payment a manual entry starts from: it carries only the currency, so it
 * does not parse until `updateBankPaymentFields` fills in the account and
 * whatever else its format requires. BRL is a Pix code, the others SPD.
 */
export const createBlankBankPayment = (
  currency: BankPaymentOfferCurrency,
): BankPayment =>
  currency === "BRL"
    ? { fields: { CC: "BRL" }, format: "pix", payload: BLANK_PIX_PAYLOAD }
    : {
        fields: { CC: currency },
        format: "spd",
        payload: `SPD*1.0*CC:${currency}`,
      };

// Fields a user may change before forwarding the payment, in display order.
// The amount is edited separately; the currency stays fixed because it
// selects which contacts can be asked to pay.
export const getBankPaymentEditableFieldKeys = (
  format: BankPaymentFormat,
): readonly BankPaymentFieldKey[] => {
  switch (format) {
    case "epc":
      return EPC_EDITABLE_FIELD_KEYS;
    case "payme":
      return PAYME_EDITABLE_FIELD_KEYS;
    case "pix":
      return PIX_EDITABLE_FIELD_KEYS;
    default:
      return SPD_EDITABLE_FIELD_KEYS;
  }
};

const normalizeBankPaymentAmount = (value: string): string => {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return "";
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("bank-payment-invalid-amount");
  }
  return normalized;
};

// Accepts an IBAN or a Czech/Slovak domestic account number; the country of
// the scanned IBAN decides which one a domestic number becomes.
const normalizeBankPaymentAccount = (
  value: string,
  originalIban: string,
): string => {
  if (!value.trim()) return "";
  const iban = normalizeBankAccountInput(
    value,
    getDomesticBankAccountCountry(originalIban) ?? "CZ",
  );
  if (!iban) throw new Error("bank-payment-invalid-account");
  return iban;
};

const normalizeBankPaymentBic = (value: string): string => {
  const bic = value.replace(/\s/g, "").toUpperCase();
  if (bic && !isValidBic(bic)) throw new Error("bank-payment-invalid-bic");
  return bic;
};

// A Pix key is a CPF/CNPJ, phone, e-mail or random key; the bank app checks
// which, so only the length and the absence of whitespace are enforced.
const normalizePixKey = (value: string): string => {
  const key = value.trim();
  if (key && (key.length > PIX_KEY_MAX_LENGTH || /\s/.test(key))) {
    throw new Error("bank-payment-invalid-account");
  }
  return key;
};

// Pix text fields are ASCII only, so accents are stripped rather than
// rejected: "João" becomes "Joao", which is what Brazilian banks print anyway.
const normalizePixText = (value: string, error: string): string => {
  const text = value.trim().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error(error);
  return text;
};

const normalizePixField = (key: string, value: string): string => {
  switch (key) {
    case "ACC":
      return normalizePixKey(value);
    case "AM":
      return normalizeBankPaymentAmount(value);
    case "CITY": {
      const city = normalizePixText(value, "bank-payment-invalid-city");
      if (city.length > PIX_CITY_MAX_LENGTH) {
        throw new Error("bank-payment-invalid-city");
      }
      return city;
    }
    case "MSG":
      return normalizePixText(value, "bank-payment-invalid-message");
    case "RF": {
      const reference = normalizePixText(
        value,
        "bank-payment-invalid-reference",
      );
      if (reference && !PIX_TXID_PATTERN.test(reference)) {
        throw new Error("bank-payment-invalid-reference");
      }
      return reference;
    }
    case "RN": {
      const name = normalizePixText(value, "bank-payment-invalid-recipient");
      if (name.length > PIX_RECIPIENT_MAX_LENGTH) {
        throw new Error("bank-payment-invalid-recipient");
      }
      return name;
    }
    default:
      return value.trim();
  }
};

const normalizeBankPaymentField = (
  payment: BankPayment,
  key: string,
  value: string,
): string => {
  if (payment.format === "pix") return normalizePixField(key, value);
  switch (key) {
    case "ACC":
      return normalizeBankPaymentAccount(value, payment.fields["ACC"] ?? "");
    case "AM":
      return normalizeBankPaymentAmount(value);
    case "BIC":
      return normalizeBankPaymentBic(value);
    default:
      return value.trim();
  }
};

const mergeBankPaymentFields = (
  payment: BankPayment,
  edits: Record<string, string>,
): Record<string, string> => {
  const fields = { ...payment.fields };
  for (const [key, value] of Object.entries(edits)) {
    const normalized = normalizeBankPaymentField(payment, key, value);
    if (normalized) fields[key] = normalized;
    else delete fields[key];
  }
  return fields;
};

// The SPD spec only allows 0-9, A-Z, space, $, +, -, ., / and : unescaped;
// lowercase letters are kept as-is because scanned payloads commonly carry
// them and bank apps accept them, while escaping would bloat the QR.
const SPD_UNESCAPED_CHAR = /^[0-9A-Za-z $+\-./:]$/;

const encodeSpdValue = (value: string): string => {
  let encoded = "";
  for (const char of value) {
    if (SPD_UNESCAPED_CHAR.test(char)) {
      encoded += char;
      continue;
    }
    for (const byte of new TextEncoder().encode(char)) {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return encoded;
};

// CRC32 authenticates the original string, so it is dropped once any field
// changes. The BIC travels inside ACC, as the SPD spec defines it.
const serializeSpdPayment = (fields: Record<string, string>): string =>
  [
    "SPD",
    "1.0",
    ...Object.entries(fields).flatMap(([key, value]) => {
      if (key === "CRC32" || key === "BIC") return [];
      const encoded =
        key === "ACC" && fields["BIC"]
          ? `${encodeSpdValue(value)}+${encodeSpdValue(fields["BIC"])}`
          : encodeSpdValue(value);
      return [`${key}:${encoded}`];
    }),
  ].join("*");

const serializeEpcPayment = (
  payload: string,
  fields: Record<string, string>,
): string => {
  const lines = payload.replace(/\r\n/g, "\n").split("\n");
  while (lines.length < 11) lines.push("");
  lines[4] = fields["BIC"] ?? "";
  lines[5] = fields["RN"] ?? "";
  lines[6] = fields["ACC"] ?? "";
  lines[7] = `EUR${fields["AM"] ?? ""}`;
  lines[9] = fields["RF"] ?? "";
  lines[10] = fields["MSG"] ?? "";
  return lines.join("\n");
};

const serializePayBySquarePayment = (
  payload: string,
  fields: Record<string, string>,
): string => {
  const model = decodePayBySquare(payload);
  const payment = model.payments[0];
  if (!payment || payment.type !== PaymentOptions.PaymentOrder) {
    throw new Error("bank-payment-unsupported-bysquare-type");
  }

  const next = {
    ...payment,
    bankAccounts: [
      { iban: fields["ACC"] ?? "" },
      ...payment.bankAccounts.slice(1),
    ],
    beneficiary: { ...payment.beneficiary, name: fields["RN"] ?? "" },
  };
  const bic = fields["BIC"];
  if (bic && next.bankAccounts[0]) next.bankAccounts[0].bic = bic;

  delete next.amount;
  delete next.constantSymbol;
  delete next.originatorsReferenceInformation;
  delete next.paymentDueDate;
  delete next.paymentNote;
  delete next.specificSymbol;
  delete next.variableSymbol;
  if (fields["AM"]) next.amount = Number(fields["AM"]);
  if (fields["X-KS"]) next.constantSymbol = fields["X-KS"];
  if (fields["RF"]) next.originatorsReferenceInformation = fields["RF"];
  if (fields["DT"]) next.paymentDueDate = fields["DT"];
  if (fields["MSG"]) next.paymentNote = fields["MSG"];
  if (fields["X-SS"]) next.specificSymbol = fields["X-SS"];
  if (fields["X-VS"]) next.variableSymbol = fields["X-VS"];

  return encodePayBySquare({
    ...model,
    payments: [next, ...model.payments.slice(1)],
  });
};

// Spaces are encoded as `+` and `/` as `%2F`, which is what URLSearchParams
// produces and what the standard's own examples use.
const serializePaymePayment = (
  payload: string,
  fields: Record<string, string>,
): string => {
  const url = parsePaymeUrl(payload);
  if (!url) throw new Error("bank-payment-invalid-payme");

  const symbols = ["X-VS", "X-SS", "X-KS"].map((key) => fields[key] ?? "");
  if (symbols.some(Boolean) && fields["RF"]) {
    throw new Error("bank-payment-invalid-reference");
  }
  const reference = symbols.some(Boolean)
    ? `/VS${symbols[0]}/SS${symbols[1]}/KS${symbols[2]}`
    : (fields["RF"] ?? "");

  const params = new URLSearchParams();
  if (url.searchParams.get("V") === "1") params.set("V", "1");
  for (const [name, value] of [
    ["IBAN", fields["ACC"]],
    ["AM", fields["AM"]],
    ["CC", fields["CC"]],
    ["DT", fields["DT"]],
    ["PI", reference],
    ["MSG", fields["MSG"]],
    ["CN", fields["RN"]],
  ] as const) {
    if (value) params.set(name, value);
  }
  url.search = params.toString();
  return url.toString();
};

// Tags keep their original ids and order; a new tag goes where its id sorts.
const replaceEmvTag = (
  tags: readonly EmvTag[],
  id: string,
  value: string,
): EmvTag[] => {
  const kept = tags.filter((tag) => tag.id !== id);
  if (!value) return kept;
  const index = kept.findIndex((tag) => Number(tag.id) > Number(id));
  const next = { id, value };
  return index === -1
    ? [...kept, next]
    : [...kept.slice(0, index), next, ...kept.slice(index)];
};

// The key goes back into the subtag it came from (01 for a static key, 25 for
// a dynamic payload URL); the amount is written with two decimals because
// bank apps expect the cents.
const serializePixPayment = (
  payload: string,
  fields: Record<string, string>,
): string => {
  const { account, tags } = parsePixTags(payload);
  const accountTag = tags.find(isPixMerchantAccountTag);
  if (!accountTag) throw new Error("bank-payment-invalid-pix");
  if (!fields["RN"]) throw new Error("bank-payment-invalid-recipient");
  if (!fields["CITY"]) throw new Error("bank-payment-invalid-city");

  const keySubtagId = account.some((subtag) => subtag.id === "25")
    ? "25"
    : "01";
  const nextAccount = replaceEmvTag(
    replaceEmvTag(account, keySubtagId, fields["ACC"] ?? ""),
    "02",
    fields["MSG"] ?? "",
  );
  const additionalData = replaceEmvTag(
    parseEmvTags(getEmvTagValue(tags, "62")) ?? [],
    "05",
    fields["RF"] || PIX_EMPTY_TXID,
  );
  const amount = fields["AM"] ? Number(fields["AM"]).toFixed(2) : "";

  const replacements: ReadonlyArray<readonly [string, string]> = [
    [accountTag.id, serializeEmvTags(nextAccount)],
    ["54", amount],
    ["59", fields["RN"]],
    ["60", fields["CITY"]],
    ["62", serializeEmvTags(additionalData)],
    ["63", ""],
  ];
  const body = replacements.reduce(
    (next, [id, value]) => replaceEmvTag(next, id, value),
    tags,
  );
  const withoutCrc = `${serializeEmvTags(body)}6304`;
  return `${withoutCrc}${crc16Ccitt(withoutCrc)}`;
};

// Re-encodes the payment in its original QR format with the edited fields
// applied; empty values remove the field. Throws when the result is not a
// valid payment (e.g. missing account or malformed amount).
export const updateBankPaymentFields = (
  payment: BankPayment,
  edits: Record<string, string>,
): BankPayment => {
  const fields = mergeBankPaymentFields(payment, edits);
  const serialize = (): string => {
    switch (payment.format) {
      case "spd":
        return serializeSpdPayment(fields);
      case "epc":
        return serializeEpcPayment(payment.payload, fields);
      case "payme":
        return serializePaymePayment(payment.payload, fields);
      case "pix":
        return serializePixPayment(payment.payload, fields);
      default:
        return serializePayBySquarePayment(payment.payload, fields);
    }
  };
  return parseBankPayment(serialize());
};
