// Incoming links arrive through the OS on native; P6 routes them here.

type Subscribe<T> = (onLink: (link: T) => void) => () => void;

const unsubscribed = () => () => {};

export const captureLaunchHashLink = (): void => {};

/** Site login and Cashu links, as text for the scanned-text handler. */
export const subscribeScanHashLinks: Subscribe<string> = unsubscribed;

/** `?notificationOpen=` details from a notification tap. */
export const subscribeNotificationOpenHashLinks: Subscribe<string> =
  unsubscribed;

/** `#add/<npub>` profile links from linky.fit, as the npub. */
export const subscribeAddContactHashLinks: Subscribe<string> = unsubscribed;
