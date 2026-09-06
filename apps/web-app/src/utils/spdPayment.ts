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
import { safeDecodeURIComponent } from "./url";

type BankPaymentFormat = "bysquare" | "epc" | "spd";

export interface BankPayment {
  fields: Record<string, string>;
  format: BankPaymentFormat;
  payload: string;
}

interface SpdPayment extends BankPayment {
  format: "spd";
}

const SPAYD_FILENAME = "platba.spayd";
const SPD_QR_JPEG_FILENAME = "platba.jpg";
const SPAYD_MIME_TYPE = "application/x-shortpaymentdescriptor";
const SPD_QR_JPEG_MIME_TYPE = "image/jpeg";

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
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(account)) {
    throw new Error("spd-missing-account");
  }

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

export const parseBankPayment = (input: string): BankPayment => {
  const payload = input.trim();
  if (isSpdPaymentPayload(payload)) return parseSpdPayment(payload);
  if (payload.replace(/\r\n/g, "\n").startsWith("BCD\n")) {
    return parseEpcPayment(payload);
  }
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
  return (
    BYSQUARE_PAYLOAD_PATTERN.test(payload) &&
    tryParseBankPayment(payload) !== null
  );
};

type BankPaymentOfferCurrency = "CZK" | "EUR";

export const getBankPaymentOfferCurrency = (
  input: string,
): BankPaymentOfferCurrency | null => {
  const currency = (
    tryParseBankPayment(input)?.fields["CC"] ?? ""
  ).toUpperCase();
  return currency === "CZK" || currency === "EUR" ? currency : null;
};

export type BankPaymentFieldKey =
  | "ACC"
  | "AM"
  | "BIC"
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

// Fields a user may change before forwarding the payment, in display order.
// The amount is edited separately; the currency stays fixed because it
// selects which contacts can be asked to pay.
export const getBankPaymentEditableFieldKeys = (
  format: BankPaymentFormat,
): readonly BankPaymentFieldKey[] =>
  format === "epc" ? EPC_EDITABLE_FIELD_KEYS : SPD_EDITABLE_FIELD_KEYS;

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

const normalizeBankPaymentField = (
  payment: BankPayment,
  key: string,
  value: string,
): string => {
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

// Re-encodes the payment in its original QR format with the edited fields
// applied; empty values remove the field. Throws when the result is not a
// valid payment (e.g. missing account or malformed amount).
export const updateBankPaymentFields = (
  payment: BankPayment,
  edits: Record<string, string>,
): BankPayment => {
  const fields = mergeBankPaymentFields(payment, edits);
  const payload =
    payment.format === "spd"
      ? serializeSpdPayment(fields)
      : payment.format === "epc"
        ? serializeEpcPayment(payment.payload, fields)
        : serializePayBySquarePayment(payment.payload, fields);
  return parseBankPayment(payload);
};

const openSpdPaymentOniOS = async (spdPayload: string): Promise<void> => {
  const file = new File([spdPayload], SPAYD_FILENAME, {
    type: SPAYD_MIME_TYPE,
  });
  const shareData: ShareData = {
    files: [file],
    title: "QR platba",
  };

  if (!navigator.share || !navigator.canShare?.(shareData)) {
    throw new Error("spd-share-unavailable");
  }

  await navigator.share(shareData);
};

const openSpdPaymentOnAndroid = async (spdPayload: string): Promise<void> => {
  if (!navigator.serviceWorker) {
    throw new Error("spd-service-worker-unavailable");
  }

  await navigator.serviceWorker.ready;

  const params = new URLSearchParams({
    data: spdPayload,
    disposition: "inline",
    filename: SPAYD_FILENAME,
    type: SPAYD_MIME_TYPE,
  });
  const url = new URL("platba.spayd", window.location.href);
  url.search = params.toString();

  window.location.assign(url.toString());
};

export const openSpdPaymentInBank = async (
  spdPayload: string,
): Promise<void> => {
  const payment = parseBankPayment(spdPayload);
  if (payment.format !== "spd") {
    await shareSpdPaymentQrJpeg(payment.payload);
    return;
  }

  if (/Android/i.test(navigator.userAgent)) {
    await openSpdPaymentOnAndroid(payment.payload);
    return;
  }

  await openSpdPaymentOniOS(payment.payload);
};

const canvasToJpegBlob = async (canvas: HTMLCanvasElement): Promise<Blob> => {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, SPD_QR_JPEG_MIME_TYPE, 0.95);
  });

  if (!blob) {
    throw new Error("spd-qr-share-failed");
  }

  return blob;
};

export const shareSpdPaymentQrJpeg = async (
  spdPayload: string,
): Promise<void> => {
  if (typeof navigator.share !== "function") {
    throw new Error("spd-share-unavailable");
  }

  const QRCode = await import("qrcode");
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, spdPayload, {
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
    errorCorrectionLevel: "M",
    margin: 2,
    width: 1024,
  });

  const blob = await canvasToJpegBlob(canvas);
  const file = new File([blob], SPD_QR_JPEG_FILENAME, {
    type: SPD_QR_JPEG_MIME_TYPE,
  });
  const shareData: ShareData = {
    files: [file],
    title: "QR platba",
  };

  if (
    typeof navigator.canShare === "function" &&
    !navigator.canShare(shareData)
  ) {
    throw new Error("spd-share-unavailable");
  }

  await navigator.share(shareData);
};
