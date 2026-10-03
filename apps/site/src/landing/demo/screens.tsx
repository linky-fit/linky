import type { ComponentType } from "react";
import type { Screen } from "../copy";
import { ChatPaymentScreen, ChatRequestScreen } from "./chat";
import { ContactsScreen, WalletScreen } from "./home";
import { ProxyOfferScreen } from "./proxy";
import { RecurringListScreen } from "./recurring";
import { TokenShareScreen } from "./token";

export const demoScreens: Record<Screen, ComponentType> = {
  "chat-payment": ChatPaymentScreen,
  "chat-request": ChatRequestScreen,
  contacts: ContactsScreen,
  wallet: WalletScreen,
  "proxy-offer": ProxyOfferScreen,
  "recurring-list": RecurringListScreen,
  "token-share": TokenShareScreen,
};
