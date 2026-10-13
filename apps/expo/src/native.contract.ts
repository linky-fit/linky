// Each `.native` module must export what its web sibling exports, with
// compatible types. Checked by tsconfig.contract.json, which resolves without
// moduleSuffixes so a bare path names the web module.
import type * as webMain from "./main";
import * as nativeMain from "./main.native";

export const main: typeof webMain = nativeMain;
