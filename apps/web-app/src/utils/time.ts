export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
