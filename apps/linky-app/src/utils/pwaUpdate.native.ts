// The native app updates through the store: there is never a waiting web
// update to apply.

type Listener = (needRefresh: boolean) => void;

export const recordPwaRegistered: (
  fn: ((reloadPage?: boolean) => Promise<void>) | null,
) => void = () => {};

export const markPwaNeedRefresh: (value: boolean) => void = () => {};

export const recordPwaControllerChange = () => {};

export const subscribePwaNeedRefresh = (listener: Listener) => {
  listener(false);
  return () => {};
};

export const isApplyingPwaUpdate = () => false;

export const deferPwaUpdateWhile: (work: Promise<void>) => void = () => {};

export const handlePwaUpdateAvailable = async () => {};

export const applyPwaUpdate = async () => {};
