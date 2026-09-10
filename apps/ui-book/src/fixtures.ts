import type { NavItem, AttachmentDraft } from "@linky/ui";
export const people = [
  {
    name: "Anna Novak",
    uri: "/avatars/anna.png",
    preview: "Thanks for dinner! See you soon.",
    time: "12:42",
  },
  {
    name: "Tomas Svoboda",
    uri: "/avatars/tomas.png",
    preview: "Sent you my part for the weekend.",
    time: "11:18",
  },
  {
    name: "Klara",
    uri: "/avatars/klara.png",
    preview: "Coffee next week?",
    time: "Yesterday",
  },
];
export const navigation: NavItem[] = [
  { value: "wallet", label: "Wallet", icon: "Wallet" },
  { value: "people", label: "People", icon: "Users" },
];
export const sampleAttachment: AttachmentDraft = {
  id: "receipt",
  name: "Dinner receipt.pdf",
  removeLabel: "Remove dinner receipt",
};
