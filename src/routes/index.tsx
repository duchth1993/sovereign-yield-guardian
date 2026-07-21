import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  formatUnits,
  parseUnits,
  type Eip1193Provider,
} from "ethers";
import { Unplug } from "lucide-react";
import {
  ERC20_ABI,
  OPN_CHAIN,
  SOVEREIGN_YIELD_ABI,
  SOVEREIGN_YIELD_ADDRESS,
  STABLECOIN_ADDRESS,
  STABLECOIN_DECIMALS,
  STABLECOIN_SYMBOL,
  TIERS,
  nextTier,
  tierForRep,
} from "@/lib/contract";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sovereign Yield — Reputation-driven yield on OPN Chain" },
      {
        name: "description",
        content:
          "A permissionless yield optimizer on OPN Chain. APY scales with your Nexus REP tier. Every deposit updates your on-chain reputation — no anonymous farming.",
      },
      { property: "og:title", content: "Sovereign Yield — Reputation-driven yield on OPN Chain" },
      {
        property: "og:description",
        content:
          "A permissionless yield optimizer on OPN Chain. APY scales with your Nexus REP tier. Every deposit updates your on-chain reputation — no anonymous farming.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SovereignYieldPage,
});

type Eth = Eip1193Provider & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function getInjected(): Eth | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ethereum?: Eth }).ethereum ?? null;
}

const readProvider = new JsonRpcProvider(OPN_CHAIN.rpcUrl, OPN_CHAIN.chainId);

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function txExplorerUrl(hash: string) {
  return `${OPN_CHAIN.blockExplorerUrl}/tx/${hash}`;
}

function addrExplorerUrl(addr: string) {
  return `${OPN_CHAIN.blockExplorerUrl}/address/${addr}`;
}

// REP is stored on-chain as a raw uint256 with an implicit 1e6 scale
// (matching the stablecoin's 6 decimals). Display it as a 1:1 decimal.
const REP_SCALE = 1_000_000;
function formatRep(raw: bigint): string {
  return (Number(raw) / REP_SCALE).toFixed(6);
}
function repToDisplayNumber(raw: bigint): number {
  return Number(raw) / REP_SCALE;
}

type ActivityRow = {
  kind: "Deposit" | "Withdraw";
  amount: string;
  hash: string;
  repDelta: string;
  ts: number;
};

function SovereignYieldPage() {
  const [account, setAccount] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [principal, setPrincipal] = useState<bigint>(0n);
  const [reputation, setReputation] = useState<bigint>(0n);
  const [walletBalance, setWalletBalance] = useState<bigint>(0n);
  const [inputAmount, setInputAmount] = useState("100");
  const [pending, setPending] = useState<null | "deposit" | "withdraw" | "approve">(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [repFlash, setRepFlash] = useState<string | null>(null);
  const [onChainTierIdx, setOnChainTierIdx] = useState<number | null>(null);
  const [repToast, setRepToast] = useState<{
    delta: string;
    tier: string | null;
    hash: string | null;
  } | null>(null);
  const [switchingUi, setSwitchingUi] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const prevTierRef = useRef<string | null>(null);
  const seenTxRef = useRef<Set<string>>(new Set());

  const contractsConfigured = !!SOVEREIGN_YIELD_ADDRESS;
  const stablecoinConfigured = !!STABLECOIN_ADDRESS;

  const displayedRep = useMemo(() => repToDisplayNumber(reputation), [reputation]);
  const derivedTier = useMemo(() => tierForRep(displayedRep), [displayedRep]);
  const tier =
    onChainTierIdx !== null && TIERS[onChainTierIdx] ? TIERS[onChainTierIdx] : derivedTier;
  const upcoming = useMemo(() => nextTier(displayedRep), [displayedRep]);
  const tierIndex = TIERS.findIndex((t) => t.tier === tier.tier);

  const refreshAccount = useCallback(
    async (addr: string) => {
      if (!contractsConfigured) return;
      try {
        const yieldC = new Contract(SOVEREIGN_YIELD_ADDRESS, SOVEREIGN_YIELD_ABI, readProvider);
        const acct = (await yieldC.getAccount(addr)) as [bigint, bigint, bigint];
        setPrincipal(acct[0]);
        setReputation((prev) => {
          if (acct[1] > prev && prev !== 0n) {
            const delta = acct[1] - prev;
            setRepFlash(`+${formatRep(delta)} REP`);
            if (flashTimer.current) window.clearTimeout(flashTimer.current);
            flashTimer.current = window.setTimeout(() => setRepFlash(null), 1600);
          }
          return acct[1];
        });

        // Best-effort: contract may expose getCurrentTier(address) -> uint (0..4 or 1..5).
        try {
          const t = (await yieldC.getCurrentTier(addr)) as bigint;
          const raw = Number(t);
          const idx = raw >= 1 && raw <= TIERS.length ? raw - 1 : raw;
          if (idx >= 0 && idx < TIERS.length) setOnChainTierIdx(idx);
        } catch {
          // contract doesn't expose it — fall back to REP-derived tier
        }

        if (stablecoinConfigured) {
          try {
            const stable = new Contract(STABLECOIN_ADDRESS, ERC20_ABI, readProvider);
            const bal = (await stable.balanceOf(addr)) as bigint;
            setWalletBalance(bal);
          } catch (e) {
            console.error("stablecoin balance failed", e);
          }
        }
      } catch (e) {
        console.error("refreshAccount failed", e);
      }
    },
    [contractsConfigured, stablecoinConfigured],
  );

  const switchNetwork = useCallback(async () => {
    setError(null);
    const eth = getInjected();
    if (!eth) {
      setError("No wallet detected. Install MetaMask to switch to OPN Chain.");
      return false;
    }
    setSwitchingUi(true);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: OPN_CHAIN.chainIdHex }],
      });
      setChainOk(true);
      return true;
    } catch (switchErr) {
      const code = (switchErr as { code?: number }).code;
      if (code === 4902) {
        try {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: OPN_CHAIN.chainIdHex,
                chainName: OPN_CHAIN.name,
                rpcUrls: [OPN_CHAIN.rpcUrl],
                nativeCurrency: OPN_CHAIN.currency,
                blockExplorerUrls: [OPN_CHAIN.blockExplorerUrl],
              },
            ],
          });
          setChainOk(true);
          return true;
        } catch (addErr) {
          setError((addErr as Error).message ?? "Failed to add OPN Chain.");
          return false;
        }
      }
      setError((switchErr as Error).message ?? "Failed to switch network.");
      return false;
    } finally {
      setSwitchingUi(false);
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    const eth = getInjected();
    if (!eth) {
      setError(
        "No wallet detected. Install MetaMask (or any EIP-1193 wallet) to interact with OPN Chain.",
      );
      return;
    }
    try {
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const addr = accounts[0];
      setAccount(addr);
      await switchNetwork();
      await refreshAccount(addr);
    } catch (e) {
      setError((e as Error).message ?? "Wallet connection failed");
    }
  }, [refreshAccount, switchNetwork]);

  const disconnect = useCallback(async () => {
    const eth = getInjected();
    if (eth) {
      try {
        // Best-effort revoke; not all wallets implement it.
        await eth.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        /* ignore */
      }
      try {
        const cid = (await eth.request({ method: "eth_chainId" })) as string;
        setChainOk(cid.toLowerCase() === OPN_CHAIN.chainIdHex);
      } catch {
        setChainOk(false);
      }
    } else {
      setChainOk(false);
    }
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = null;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setAccount(null);
    setPrincipal(0n);
    setReputation(0n);
    setWalletBalance(0n);
    setInputAmount("100");
    setPending(null);
    setError(null);
    setLastTx(null);
    setActivity([]);
    setRepFlash(null);
    setOnChainTierIdx(null);
    setRepToast(null);
    prevTierRef.current = null;
    seenTxRef.current.clear();
  }, []);

  // Detect current chain on mount + listen for changes.
  useEffect(() => {
    const eth = getInjected();
    if (!eth) return;
    void (async () => {
      try {
        const cid = (await eth.request({ method: "eth_chainId" })) as string;
        setChainOk(cid.toLowerCase() === OPN_CHAIN.chainIdHex);
        const accs = (await eth.request({ method: "eth_accounts" })) as string[];
        if (accs[0]) {
          setAccount(accs[0]);
          void refreshAccount(accs[0]);
        }
      } catch {
        /* ignore */
      }
    })();
    if (!eth.on) return;
    const onAcc = (accs: unknown) => {
      const list = accs as string[];
      setAccount(list[0] ?? null);
      if (list[0]) void refreshAccount(list[0]);
    };
    const onChain = (cid: unknown) => {
      setChainOk((cid as string).toLowerCase() === OPN_CHAIN.chainIdHex);
    };
    eth.on("accountsChanged", onAcc);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [refreshAccount]);

  // Subscribe to ReputationBoosted for the current account (live REP updates).
  useEffect(() => {
    if (!account || !contractsConfigured) return;
    const c = new Contract(SOVEREIGN_YIELD_ADDRESS, SOVEREIGN_YIELD_ABI, readProvider);
    const filter = c.filters.ReputationBoosted(account);
    // Safe ethers v6 pattern: last arg is the EventPayload with .log.transactionHash.
    const handler = (...args: unknown[]) => {
      try {
        const newRep = args[1] as bigint;
        const payload = args[args.length - 1] as { log?: { transactionHash?: string } };
        const hash = payload?.log?.transactionHash ?? null;
        if (hash) {
          if (seenTxRef.current.has(hash)) return;
          seenTxRef.current.add(hash);
        }
        if (hash) setLastTx(hash);
        setReputation((prev) => {
          if (newRep > prev) {
            const delta = newRep - prev;
            setRepFlash(`+${formatRep(delta)} REP`);
            if (flashTimer.current) window.clearTimeout(flashTimer.current);
            flashTimer.current = window.setTimeout(() => setRepFlash(null), 1600);

            const newTier = tierForRep(repToDisplayNumber(newRep));
            const tierChanged =
              prevTierRef.current !== null && prevTierRef.current !== newTier.tier;
            setRepToast({
              delta: `+${formatRep(delta)}`,
              tier: tierChanged ? newTier.tier : null,
              hash,
            });
            prevTierRef.current = newTier.tier;
            if (toastTimer.current) window.clearTimeout(toastTimer.current);
            toastTimer.current = window.setTimeout(() => setRepToast(null), 8000);
          } else {
            prevTierRef.current = tierForRep(repToDisplayNumber(newRep)).tier;
          }
          return newRep;
        });
      } catch (err) {
        console.error("ReputationBoosted handler failed", err);
      }
    };
    c.on(filter, handler);
    return () => {
      void c.off(filter, handler);
    };
  }, [account, contractsConfigured]);

  const pushRepToast = useCallback((hash: string, delta: bigint, newRep: bigint) => {
    if (hash) {
      if (seenTxRef.current.has(hash)) return;
      seenTxRef.current.add(hash);
      setLastTx(hash);
    }
    if (delta > 0n) {
      setRepFlash(`+${formatRep(delta)} REP`);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setRepFlash(null), 1600);
    }
    const newTier = tierForRep(repToDisplayNumber(newRep));
    const tierChanged = prevTierRef.current !== null && prevTierRef.current !== newTier.tier;
    setRepToast({
      delta: `+${formatRep(delta)}`,
      tier: tierChanged ? newTier.tier : null,
      hash: hash || null,
    });
    prevTierRef.current = newTier.tier;
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setRepToast(null), 8000);
  }, []);

  const runTx = useCallback(
    async (kind: "deposit" | "withdraw") => {
      setError(null);
      setLastTx(null);
      const eth = getInjected();
      if (!eth || !account) {
        setError("Connect your wallet first.");
        return;
      }
      if (!contractsConfigured) {
        setError(
          "Contract address not set. Deploy contracts/SovereignYield.sol to OPN Chain and configure VITE_SOVEREIGN_YIELD_ADDRESS / VITE_STABLECOIN_ADDRESS.",
        );
        return;
      }
      let amount: bigint;
      try {
        amount = parseUnits(inputAmount || "0", STABLECOIN_DECIMALS);
        if (amount <= 0n) throw new Error("Amount must be greater than zero.");
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      try {
        const browserProvider = new BrowserProvider(eth);
        const signer = await browserProvider.getSigner();
        const yieldC = new Contract(SOVEREIGN_YIELD_ADDRESS, SOVEREIGN_YIELD_ABI, signer);

        const prevRep = reputation;

        if (kind === "deposit") {
          if (!stablecoinConfigured) {
            setError(
              "Stablecoin address not set. Configure VITE_STABLECOIN_ADDRESS to enable deposits.",
            );
            setPending(null);
            return;
          }
          const stable = new Contract(STABLECOIN_ADDRESS, ERC20_ABI, signer);
          const allowance: bigint = await stable.allowance(account, SOVEREIGN_YIELD_ADDRESS);
          if (allowance < amount) {
            setPending("approve");
            const approveTx = await stable.approve(SOVEREIGN_YIELD_ADDRESS, amount);
            await approveTx.wait();
          }
          setPending("deposit");
          const tx = await yieldC.deposit(amount);
          setLastTx(tx.hash);
          const receipt = await tx.wait();
          await refreshAccount(account);
          const newRep = (await new Contract(
            SOVEREIGN_YIELD_ADDRESS,
            SOVEREIGN_YIELD_ABI,
            readProvider,
          ).reputation(account)) as bigint;
          setActivity((rows) =>
            [
              {
                kind: "Deposit" as const,
                amount: formatUnits(amount, STABLECOIN_DECIMALS),
                hash: tx.hash,
                repDelta: `+${formatRep(newRep - prevRep)}`,
                ts: receipt?.blockNumber ? Date.now() : Date.now(),
              },
              ...rows,
            ].slice(0, 6),
          );
          pushRepToast(tx.hash, newRep - prevRep, newRep);
        } else {
          setPending("withdraw");
          const tx = await yieldC.withdraw(amount);
          setLastTx(tx.hash);
          await tx.wait();
          await refreshAccount(account);
          const newRep = (await new Contract(
            SOVEREIGN_YIELD_ADDRESS,
            SOVEREIGN_YIELD_ABI,
            readProvider,
          ).reputation(account)) as bigint;
          setActivity((rows) =>
            [
              {
                kind: "Withdraw" as const,
                amount: formatUnits(amount, STABLECOIN_DECIMALS),
                hash: tx.hash,
                repDelta: `+${formatRep(newRep - prevRep)}`,
                ts: Date.now(),
              },
              ...rows,
            ].slice(0, 6),
          );
          pushRepToast(tx.hash, newRep - prevRep, newRep);
        }
      } catch (e) {
        const msg =
          (e as { shortMessage?: string; message?: string }).shortMessage ??
          (e as Error).message ??
          "Transaction failed";
        setError(msg);
      } finally {
        setPending(null);
      }
    },
    [
      account,
      contractsConfigured,
      stablecoinConfigured,
      inputAmount,
      refreshAccount,
      reputation,
      pushRepToast,
    ],
  );

  const busy = pending !== null;
  const canAct = account && chainOk && contractsConfigured && !busy;

  const principalHuman = formatUnits(principal, STABLECOIN_DECIMALS);
  const walletHuman = formatUnits(walletBalance, STABLECOIN_DECIMALS);

  // Progress within current tier
  const tierProgress = useMemo(() => {
    const repN = displayedRep;
    const start = tier.minRep;
    const end = upcoming ? upcoming.minRep : start + 1;
    const pct = Math.min(100, Math.max(0, ((repN - start) / (end - start)) * 100));
    return { pct, repN };
  }, [displayedRep, tier, upcoming]);

  return (
    <div className="min-h-screen grid-bg">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Header
          account={account}
          chainOk={chainOk}
          onConnect={connect}
          onDisconnect={disconnect}
          onSwitchNetwork={switchNetwork}
          switching={switchingUi}
        />

        {account && !chainOk && (
          <NetworkSwitchBanner onSwitch={switchNetwork} switching={switchingUi} />
        )}

        {!contractsConfigured && <DeploymentBanner />}

        <main className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <section className="card-surface p-8 relative overflow-hidden">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="relative inline-flex h-2 w-2">
                    <span className="pulse-dot absolute inset-0 rounded-full" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                  </span>
                  Live · OPN Chain #{OPN_CHAIN.chainId}
                </div>
                <h1 className="mt-3 text-4xl sm:text-5xl font-semibold leading-[1.05]">
                  Sovereign Yield
                </h1>
                <p className="mt-3 max-w-lg text-muted-foreground">
                  A permissionless yield optimizer where APY scales with your Nexus REP tier. Every
                  deposit updates your on-chain reputation.
                </p>
              </div>
              <TierBadge tier={tier.tier} apy={tier.apy} />
            </div>

            <div className="mt-8 grid grid-cols-2 gap-4">
              <Stat
                label="Your APY"
                value={`${tier.apy.toFixed(2)}%`}
                sub={`${tier.label}`}
                emphasis
                badge="Verified on-chain"
              />

              <Stat
                label="On-chain REP"
                value={`${formatRep(reputation)} REP`}
                sub={
                  upcoming
                    ? `${(upcoming.minRep - displayedRep).toLocaleString(undefined, { maximumFractionDigits: 6 })} to ${upcoming.tier}`
                    : "Maxed — Nexus tier"
                }
                flash={repFlash}
              />
              <Stat
                label="Principal"
                value={`${Number(principalHuman).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })} ${STABLECOIN_SYMBOL}`}
                sub="Deposited to vault"
              />
              <Stat
                label="Wallet"
                value={`${Number(walletHuman).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })} ${STABLECOIN_SYMBOL}`}
                sub={account ? shortAddr(account) : "Not connected"}
              />
            </div>

            <TierLadder currentIndex={tierIndex} progress={tierProgress.pct} nextTier={upcoming} />
          </section>

          <section className="card-surface p-8">
            <h2 className="text-xl font-semibold">Move capital</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Deposit or withdraw {STABLECOIN_SYMBOL}. Every action fires{" "}
              <code className="text-accent">ReputationBoosted</code> on-chain.
            </p>

            <label className="mt-6 block text-xs uppercase tracking-widest text-muted-foreground">
              Amount ({STABLECOIN_SYMBOL})
            </label>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 focus-within:accent-glow transition-shadow">
              <input
                inputMode="decimal"
                value={inputAmount}
                onChange={(e) => setInputAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0.00"
                className="w-full bg-transparent text-2xl font-display outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setInputAmount(walletHuman)}
                className="text-xs uppercase tracking-widest text-accent hover:opacity-80"
              >
                Max
              </button>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!canAct}
                onClick={() => runTx("deposit")}
                className="rounded-lg bg-accent px-4 py-3 font-medium text-accent-foreground transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 accent-glow"
              >
                {pending === "approve"
                  ? "Approving…"
                  : pending === "deposit"
                    ? "Depositing…"
                    : "Deposit"}
              </button>
              <button
                type="button"
                disabled={!canAct}
                onClick={() => runTx("withdraw")}
                className="rounded-lg border border-border bg-surface-2 px-4 py-3 font-medium transition-all hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending === "withdraw" ? "Withdrawing…" : "Withdraw"}
              </button>
            </div>

            {!account && (
              <p className="mt-4 text-xs text-muted-foreground">
                Connect a wallet to sign transactions on OPN Chain testnet.
              </p>
            )}
            {account && !chainOk && (
              <p className="mt-4 text-xs text-warning">
                Switch to OPN Chain (ID {OPN_CHAIN.chainId}) to continue.
              </p>
            )}
            {error && (
              <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </p>
            )}
            {lastTx && (
              <a
                href={txExplorerUrl(lastTx)}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex items-center justify-between rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground">Latest tx</span>
                <span className="font-mono text-accent">{shortAddr(lastTx)} ↗</span>
              </a>
            )}
          </section>
        </main>

        <ActivityPanel rows={activity} />
        <Footer />
      </div>
      {repToast && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50 rep-flash">
          <div className="pointer-events-auto rounded-xl border border-success/40 bg-surface/95 px-4 py-3 shadow-2xl backdrop-blur">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-success/15 font-mono text-sm font-semibold text-success">
                ↑
              </span>
              <div>
                <div className="font-mono text-sm text-success">
                  REP {repToast.delta}
                  {repToast.tier && (
                    <span className="text-foreground">
                      {" · "}Tier updated to {repToast.tier}
                    </span>
                  )}
                </div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  ReputationBoosted · verified on-chain
                </div>
                {repToast.hash && (
                  <a
                    href={txExplorerUrl(repToast.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block font-mono text-[11px] text-accent hover:underline"
                  >
                    Verified: {shortAddr(repToast.hash)} ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({
  account,
  chainOk,
  onConnect,
  onDisconnect,
  onSwitchNetwork,
  switching,
}: {
  account: string | null;
  chainOk: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitchNetwork: () => void;
  switching: boolean;
}) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <div className="font-display text-lg font-semibold leading-none">Sovereign Yield</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Nexus REP · NeoID-bound
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${chainOk ? "bg-success" : "bg-warning"}`} />
          <span className="text-muted-foreground">
            {chainOk ? OPN_CHAIN.name : "Wrong network"}
          </span>
        </div>
        {account && !chainOk && (
          <button
            type="button"
            onClick={onSwitchNetwork}
            disabled={switching}
            className="rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs font-medium text-warning hover:bg-warning/20 disabled:opacity-60"
          >
            {switching ? "Switching…" : `Switch to ${OPN_CHAIN.name}`}
          </button>
        )}
        {account ? (
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-border bg-surface px-4 py-2 font-mono text-sm">
              {shortAddr(account)}
            </div>
            <button
              type="button"
              onClick={onDisconnect}
              title="Disconnect wallet"
              aria-label="Disconnect wallet"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-surface p-2.5 text-muted-foreground transition-colors hover:border-accent hover:text-accent"
            >
              <Unplug size={18} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground accent-glow hover:brightness-110"
          >
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}

function NetworkSwitchBanner({
  onSwitch,
  switching,
}: {
  onSwitch: () => void;
  switching: boolean;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-medium text-warning">Wrong network detected</div>
        <p className="mt-1 text-muted-foreground">
          Connect wallet to {OPN_CHAIN.name} (Chain ID {OPN_CHAIN.chainId}) to proceed.
        </p>
      </div>
      <button
        type="button"
        onClick={onSwitch}
        disabled={switching}
        className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground accent-glow hover:brightness-110 disabled:opacity-60"
      >
        {switching ? "Switching…" : `Switch to ${OPN_CHAIN.name}`}
      </button>
    </div>
  );
}

function Logo() {
  return (
    <div className="relative h-10 w-10 rounded-lg accent-glow">
      <div className="absolute inset-0 rounded-lg bg-accent" />
      <div className="absolute inset-[3px] rounded-md bg-background" />
      <div className="absolute inset-0 grid place-items-center font-display text-sm font-bold text-accent">
        S
      </div>
    </div>
  );
}

function TierBadge({ tier, apy }: { tier: string; apy: number }) {
  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-right">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Nexus tier
      </div>
      <div className="font-display text-2xl font-semibold text-accent">{tier}</div>
      <div className="text-xs text-muted-foreground">{apy}% APY unlocked</div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  emphasis,
  flash,
  badge,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
  flash?: string | null;
  badge?: string;
}) {
  return (
    <div
      className={`relative rounded-xl border border-border bg-surface-2 p-4 ${
        emphasis ? "accent-glow" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        {badge && (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-widest text-success">
            <span className="h-1 w-1 rounded-full bg-success" />
            {badge}
          </span>
        )}
      </div>
      <div
        className={`mt-2 font-display font-semibold ${
          emphasis ? "text-3xl text-accent" : "text-2xl"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground truncate">{sub}</div>}
      {flash && (
        <div className="rep-flash pointer-events-none absolute right-3 top-3 font-mono text-xs text-success">
          {flash}
        </div>
      )}
    </div>
  );
}

function TierLadder({
  currentIndex,
  progress,
  nextTier: next,
}: {
  currentIndex: number;
  progress: number;
  nextTier: (typeof TIERS)[number] | null;
}) {
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
        <span>Reputation ladder</span>
        <span>{next ? `Next: ${next.label} · ${next.apy}% APY` : "Top tier reached"}</span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {TIERS.map((t, i) => {
          const active = i <= currentIndex;
          const current = i === currentIndex;
          return (
            <div
              key={t.tier}
              className={`rounded-lg border p-3 text-left transition-colors ${
                current
                  ? "border-accent bg-accent-soft"
                  : active
                    ? "border-border bg-surface-2"
                    : "border-border/50 bg-surface/40 opacity-60"
              }`}
            >
              <div className="font-display text-sm font-semibold">{t.tier}</div>
              <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                {t.apy}% APY
              </div>
            </div>
          );
        })}
      </div>
      {next && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function ActivityPanel({ rows }: { rows: ActivityRow[] }) {
  return (
    <section className="mt-6 card-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent on-chain activity</h2>
        <span className="text-xs text-muted-foreground">
          Signed by your address · verifiable on explorer
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Your transactions will appear here. Each row is a real event emitted by the Sovereign
          Yield contract on OPN Chain.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {rows.map((r) => (
            <div
              key={r.hash}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 py-3 text-sm"
            >
              <span
                className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                  r.kind === "Deposit"
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-2 text-muted-foreground"
                }`}
              >
                {r.kind}
              </span>
              <span className="font-mono">
                {Number(r.amount).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                {STABLECOIN_SYMBOL}
              </span>
              <span className="font-mono text-xs text-success">{r.repDelta} REP</span>
              <a
                className="font-mono text-xs text-accent hover:underline"
                href={txExplorerUrl(r.hash)}
                target="_blank"
                rel="noreferrer"
              >
                {shortAddr(r.hash)} ↗
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeploymentBanner() {
  return (
    <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
      <div className="font-medium">Contract not yet configured</div>
      <p className="mt-1 text-muted-foreground">
        Deploy <code className="text-warning">contracts/SovereignYield.sol</code> to OPN Chain
        testnet (Chain ID {OPN_CHAIN.chainId}) along with a USDC-like ERC20, then set{" "}
        <code className="text-warning">VITE_SOVEREIGN_YIELD_ADDRESS</code> and{" "}
        <code className="text-warning">VITE_STABLECOIN_ADDRESS</code>. The UI will read live state
        and emit real <code className="text-warning">ReputationBoosted</code> events on every
        deposit and withdraw.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
      <p>Your yield grows with your reputation. Verified on OPN Testnet.</p>
      <div className="flex items-center gap-4">
        <a
          className="hover:text-foreground"
          href={OPN_CHAIN.blockExplorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          OPN Explorer ↗
        </a>
        {SOVEREIGN_YIELD_ADDRESS && (
          <a
            className="font-mono hover:text-foreground"
            href={addrExplorerUrl(SOVEREIGN_YIELD_ADDRESS)}
            target="_blank"
            rel="noreferrer"
          >
            {shortAddr(SOVEREIGN_YIELD_ADDRESS)} ↗
          </a>
        )}
      </div>
    </footer>
  );
}
