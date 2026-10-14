/** Bank code 0000 belongs to no bank, so a scanned demo QR can never move money. */
export const demoAccount = {
  display: "123456789/0000",
  iban: "CZ0000000000000123456789",
};

const demoMessage = "DEMO - NEPLATIT";

/** A Czech SPD payment string, the format the app shows for bank payments. */
export const demoSpd = (halere: number, variableSymbol: string): string =>
  [
    "SPD",
    "1.0",
    `ACC:${demoAccount.iban}`,
    `AM:${(halere / 100).toFixed(2)}`,
    "CC:CZK",
    `X-VS:${variableSymbol}`,
    `MSG:${demoMessage}`,
  ].join("*");

/** A Lightning invoice shaped like the app's, that no wallet will pay. */
export const demoInvoice = (sats: number): string =>
  `lnbc${sats * 10}n1demo0fazole0fit0demo0invoice0do0not0pay`;

/** A BIP-321 URI shaped like the app's, with a Lightning invoice and a Cashu request that no wallet will pay. */
export const demoBip321 = (sats: number): string =>
  `bitcoin:?lightning=${demoInvoice(sats)}&creq=creqAdemoFazoleFitDoNotPay`;
