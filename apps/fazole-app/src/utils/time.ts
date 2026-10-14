/** The current Unix time in whole seconds, the unit every stored event time uses. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
