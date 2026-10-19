/** The native app runs in one context: no other tab changes its storage. */
export const onStorageKeyChangedInAnotherTab: (
  key: string,
  callback: () => void,
) => () => void = () => () => {};
