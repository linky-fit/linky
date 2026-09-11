import { portraits } from "../assets";
import type { PaymentState } from "@linky/ui";
export interface Contact {
  id: string;
  name: string;
  avatar?: string;
  group: "Friends" | "Family" | "Work";
  pinned: boolean;
  unread: number;
  preview: string;
  time: string;
}
export type PaymentStatus = PaymentState;
export interface Transaction {
  id: string;
  contactId: string;
  amount: number;
  note: string;
  direction: "in" | "out";
  status: PaymentStatus;
  day: "Today" | "Yesterday";
}
export interface Attachment {
  name: string;
  url: string;
  type: "image" | "pdf";
}
export interface Message {
  id: string;
  direction: "in" | "out";
  text: string;
  time: string;
  kind: "text" | "payment" | "request" | "attachment";
  amount?: number;
  transactionId?: string;
  status?: PaymentStatus;
  attachment?: Attachment;
  reply?: string;
  reacted?: boolean;
}
export interface DemoState {
  balance: number;
  contacts: Contact[];
  transactions: Transaction[];
  messages: Record<string, Message[]>;
}
export const initialState: DemoState = {
  balance: 84250,
  contacts: [
    {
      id: "anna",
      name: "Anna Novak",
      avatar: portraits.anna,
      group: "Friends",
      pinned: true,
      unread: 0,
      preview: "Thanks for dinner! See you soon.",
      time: "12:42",
    },
    {
      id: "tomas",
      name: "Tomas Svoboda",
      avatar: portraits.tomas,
      group: "Friends",
      pinned: true,
      unread: 2,
      preview: "Sent you my part for the weekend.",
      time: "11:18",
    },
    {
      id: "klara",
      name: "Klara",
      avatar: portraits.klara,
      group: "Work",
      pinned: false,
      unread: 0,
      preview: "Coffee next week?",
      time: "Yesterday",
    },
    {
      id: "eva",
      name: "Eva Novak",
      group: "Family",
      pinned: false,
      unread: 0,
      preview: "Let’s catch up this weekend.",
      time: "Mon",
    },
    {
      id: "adam",
      name: "Adam Dvorak",
      group: "Work",
      pinned: false,
      unread: 0,
      preview: "Start a conversation",
      time: "",
    },
  ],
  transactions: [
    {
      id: "dinner",
      contactId: "anna",
      amount: 2400,
      note: "Dinner",
      direction: "out",
      status: "completed",
      day: "Today",
    },
    {
      id: "weekend",
      contactId: "tomas",
      amount: 10000,
      note: "Received",
      direction: "in",
      status: "completed",
      day: "Today",
    },
    {
      id: "coffee",
      contactId: "klara",
      amount: 650,
      note: "Coffee",
      direction: "out",
      status: "pending",
      day: "Yesterday",
    },
  ],
  messages: {
    anna: [
      {
        id: "a1",
        direction: "in",
        kind: "text",
        text: "That place was so good. We should go again!",
        time: "12:36",
      },
      {
        id: "a2",
        direction: "out",
        kind: "text",
        text: "Definitely! Sending you my half now.",
        time: "12:38",
      },
      {
        id: "a3",
        direction: "out",
        kind: "payment",
        text: "Dinner",
        amount: 2400,
        status: "completed",
        transactionId: "dinner",
        time: "12:39",
      },
      {
        id: "a4",
        direction: "in",
        kind: "text",
        text: "Thanks for dinner! See you soon.",
        time: "12:42",
      },
    ],
    tomas: [
      {
        id: "t1",
        direction: "in",
        kind: "text",
        text: "Sent you my part for the weekend.",
        time: "11:18",
      },
      {
        id: "t2",
        direction: "in",
        kind: "payment",
        text: "Weekend",
        amount: 10000,
        status: "completed",
        transactionId: "weekend",
        time: "11:18",
      },
    ],
    klara: [
      {
        id: "k1",
        direction: "in",
        kind: "text",
        text: "Coffee next week?",
        time: "Yesterday",
      },
    ],
    eva: [],
    adam: [],
  },
};
export function paymentError(amount: number, balance: number): string | null {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return "Enter a whole number of sats greater than zero.";
  if (amount > balance)
    return "Not enough funds. Try a smaller amount or receive funds first.";
  return null;
}
export type DemoAction =
  | { type: "message"; contactId: string; message: Message }
  | { type: "pay"; transaction: Transaction; time: string }
  | { type: "settle"; id: string; status: "completed" | "failed" }
  | { type: "receive"; transaction: Transaction; time: string }
  | { type: "read"; contactId: string }
  | { type: "react"; contactId: string; messageId: string }
  | { type: "contact"; contact: Contact }
  | { type: "reset" }
  | { type: "empty" }
  | { type: "zero" };
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "zero":
      return { ...state, balance: 0 };
    case "empty":
      return { balance: 0, contacts: [], transactions: [], messages: {} };
    case "contact":
      return { ...state, contacts: [...state.contacts, action.contact] };
    case "read":
      return {
        ...state,
        contacts: state.contacts.map((c) =>
          c.id === action.contactId ? { ...c, unread: 0 } : c,
        ),
      };
    case "react":
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.contactId]: (state.messages[action.contactId] ?? []).map(
            (m) =>
              m.id === action.messageId ? { ...m, reacted: !m.reacted } : m,
          ),
        },
      };
    case "message":
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.contactId]: [
            ...(state.messages[action.contactId] ?? []),
            action.message,
          ],
        },
        contacts: state.contacts.map((c) =>
          c.id === action.contactId
            ? {
                ...c,
                preview: action.message.text || "Attachment",
                time: action.message.time,
              }
            : c,
        ),
      };
    case "pay": {
      const t = action.transaction;
      if (
        state.transactions.some((item) => item.id === t.id) ||
        !state.contacts.some((c) => c.id === t.contactId) ||
        paymentError(t.amount, state.balance)
      )
        return state;
      return {
        ...state,
        balance: state.balance - t.amount,
        transactions: [
          { ...t, status: "pending", direction: "out" },
          ...state.transactions,
        ],
        messages: {
          ...state.messages,
          [t.contactId]: [
            ...(state.messages[t.contactId] ?? []),
            {
              id: t.id,
              kind: "payment",
              direction: "out",
              text: t.note,
              amount: t.amount,
              status: "pending",
              transactionId: t.id,
              time: action.time,
            },
          ],
        },
      };
    }
    case "settle": {
      const payment = state.transactions.find((t) => t.id === action.id);
      if (!payment || payment.status !== "pending") return state;
      return {
        ...state,
        balance:
          state.balance +
          (action.status === "failed" && payment.direction === "out"
            ? payment.amount
            : 0),
        transactions: state.transactions.map((t) =>
          t.id === action.id ? { ...t, status: action.status } : t,
        ),
        messages: Object.fromEntries(
          Object.entries(state.messages).map(([id, messages]) => [
            id,
            messages.map((m) =>
              m.transactionId === action.id
                ? { ...m, status: action.status }
                : m,
            ),
          ]),
        ),
      };
    }
    case "receive": {
      const t = action.transaction;
      if (
        !Number.isSafeInteger(t.amount) ||
        t.amount <= 0 ||
        state.transactions.some((item) => item.id === t.id)
      )
        return state;
      return {
        ...state,
        balance: state.balance + t.amount,
        transactions: [
          { ...t, status: "completed", direction: "in" },
          ...state.transactions,
        ],
      };
    }
  }
}
export const formatSats = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
