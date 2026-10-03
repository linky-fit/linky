// Lorelei avatars from DiceBear (CC0), as the app generates them, saved locally so the site makes no third-party requests.
export const people = [
  "Alex Rivers",
  "Ben Ellis",
  "Dave",
  "Eva Lind",
  "Eva Stone",
  "Jan Kral",
  "Lena Fox",
  "Mia Novak",
  "Mom",
  "Sam Ortiz",
  "Sofia Lane",
  "Tomas Berg",
] as const;

export type Person = (typeof people)[number];

export const avatarUri = (person: Person) =>
  `/avatars/${person.toLowerCase().replace(/ /g, "-")}.svg`;
