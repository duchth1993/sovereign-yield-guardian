// OPN Chain configuration + Sovereign Yield contract wiring.
// Deploy contracts/SovereignYield.sol to OPN Chain testnet (Chain ID 984),
// then paste the resulting addresses below. The UI reads live data from
// these contracts via ethers.js — no mock data for core logic.

export const OPN_CHAIN = {
  chainId: 984,
  chainIdHex: "0x3d8",
  name: "OPN Chain Testnet",
  rpcUrl: "https://testnet-rpc.iopn.tech",
  currency: { name: "OPN", symbol: "OPN", decimals: 18 },
  blockExplorerUrl: "https://testnet.iopn.tech",
} as const;

// Paste deployed addresses here after `forge create` / `hardhat deploy`.
// Leave empty strings to surface a clear "not deployed" state in the UI.
export const SOVEREIGN_YIELD_ADDRESS =
  (import.meta.env.VITE_SOVEREIGN_YIELD_ADDRESS as string | undefined) ?? "";
export const STABLECOIN_ADDRESS =
  (import.meta.env.VITE_STABLECOIN_ADDRESS as string | undefined) ?? "";

// USDC-style 6 decimals for the demo stablecoin.
export const STABLECOIN_DECIMALS = 6;
export const STABLECOIN_SYMBOL = "USDC";

export const SOVEREIGN_YIELD_ABI = [
  "function deposit(uint256 amount) external",
  "function withdraw(uint256 amount) external",
  "function principal(address) view returns (uint256)",
  "function reputation(address) view returns (uint256)",
  "function getAccount(address user) view returns (uint256 _principal, uint256 _reputation, uint256 _lastAction)",
  "event Deposited(address indexed user, uint256 amount, uint256 newPrincipal)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 newPrincipal)",
  "event ReputationBoosted(address indexed user, uint256 newREP)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

// Nexus REP tiers — Tier I (5%) through Tier V (18%).
// Thresholds are REP score cutoffs; APY is displayed to the user.
export const TIERS = [
  { tier: "I", label: "Tier I · Initiate", minRep: 0, apy: 5 },
  { tier: "II", label: "Tier II · Verified", minRep: 250, apy: 8 },
  { tier: "III", label: "Tier III · Trusted", minRep: 1000, apy: 11 },
  { tier: "IV", label: "Tier IV · Sovereign", minRep: 5000, apy: 14 },
  { tier: "V", label: "Tier V · Nexus", minRep: 20000, apy: 18 },
] as const;

export type Tier = (typeof TIERS)[number];

export function tierForRep(rep: bigint | number): Tier {
  const n = typeof rep === "bigint" ? Number(rep) : rep;
  let current: Tier = TIERS[0];
  for (const t of TIERS) if (n >= t.minRep) current = t;
  return current;
}

export function nextTier(rep: bigint | number) {
  const n = typeof rep === "bigint" ? Number(rep) : rep;
  return TIERS.find((t) => t.minRep > n) ?? null;
}
