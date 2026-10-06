// Kept free of imports: vitest.setup.ts loads it before every test file.
export const mountedRoots = new Set<() => Promise<void>>();

export const unmountMountedRoots = async (): Promise<void> => {
  for (const unmount of [...mountedRoots]) await unmount();
};
