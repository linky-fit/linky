/** The account the demo's bank QR codes pay to. */
export const demoAccount = {
  display: "283078181/0600",
  iban: "CZ5606000000000283078181",
};

/** A Czech SPD payment string, the format the app shows for bank payments; `message` is the shop's name, like the app's. */
export const demoSpd = (
  halere: number,
  variableSymbol: string,
  message: string,
): string =>
  [
    "SPD",
    "1.0",
    `ACC:${demoAccount.iban}`,
    `AM:${(halere / 100).toFixed(2)}`,
    "CC:CZK",
    `X-VS:${variableSymbol}`,
    `MSG:${message}`,
  ].join("*");
