// Lorelei avatars from DiceBear (CC0), copied from apps/site so the demo makes no third-party requests.
const withAvatar = [
  "Alex Rivers",
  "Ben Ellis",
  "Dave",
  "Eva Stone",
  "Jan Kral",
  "Lena Fox",
  "Mia Novak",
  "Mom",
  "Sofia Lane",
  "Tomas Berg",
] as const;

export type Person = (typeof withAvatar)[number] | "Petra Dvorakova";

const hasAvatar = (person: Person): person is (typeof withAvatar)[number] =>
  withAvatar.some((name) => name === person);

export const avatarUri = (person: Person) =>
  hasAvatar(person)
    ? `/avatars/${person.toLowerCase().replace(/ /g, "-")}.svg`
    : undefined;
