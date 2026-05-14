import { CLEAN_MINT, CLEAN_VITALS, CLEAN_HOLDERS, CLEAN_LAUNCH_TXS, CLEAN_FUNDER_EDGES } from "./clean-token";
import { BUNDLED_MINT, BUNDLED_VITALS, BUNDLED_HOLDERS, BUNDLED_LAUNCH_TXS, BUNDLED_FUNDER_EDGES } from "./bundled-token";
import type { HolderInfo, LaunchTx, FunderEdge, TokenVitals } from "../types";

export interface TokenFixture {
  vitals: TokenVitals;
  holders: HolderInfo[];
  launchTxs: LaunchTx[];
  funderEdges: FunderEdge[];
}

export const FIXTURES: Record<string, TokenFixture> = {
  [CLEAN_MINT]: {
    vitals: CLEAN_VITALS,
    holders: CLEAN_HOLDERS,
    launchTxs: CLEAN_LAUNCH_TXS,
    funderEdges: CLEAN_FUNDER_EDGES,
  },
  [BUNDLED_MINT]: {
    vitals: BUNDLED_VITALS,
    holders: BUNDLED_HOLDERS,
    launchTxs: BUNDLED_LAUNCH_TXS,
    funderEdges: BUNDLED_FUNDER_EDGES,
  },
};

export const EXAMPLE_MINTS = [
  { label: "Clean example (Honest Cat)", mint: CLEAN_MINT },
  { label: "Bundled example (Rocket Pepe)", mint: BUNDLED_MINT },
];

export { CLEAN_MINT, BUNDLED_MINT };
