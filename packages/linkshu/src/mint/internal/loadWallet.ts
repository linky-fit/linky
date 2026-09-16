import type { Mint, Wallet } from "@cashu/cashu-ts";

interface LoadWalletArgs {
  Mint: typeof Mint;
  Wallet: typeof Wallet;
  bip39seed?: Uint8Array;
  mintUrl: string;
  unit?: string | null;
}

export const loadWallet = async (args: LoadWalletArgs): Promise<Wallet> => {
  const options: NonNullable<ConstructorParameters<typeof Wallet>[1]> = {};
  const unit = args.unit?.trim();
  if (unit) options.unit = unit;
  if (args.bip39seed !== undefined) options.bip39seed = args.bip39seed;
  const wallet = new args.Wallet(new args.Mint(args.mintUrl), options);

  await wallet.loadMint();
  return wallet;
};
