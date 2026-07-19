# Sovereign Yield Guardian 🛡️

A reputation-driven DeFi vault on OPN Chain where **your yield scales with your sovereign identity**. Built for Season 1 · DeFi & Open Finance.

> “Your identity follows every transaction.” — IOPn

🔗 **Live Demo**: https://sovereign-yield-guardian.lovable.app/  
📦 **Repo**: https://github.com/duchth1993/sovereign-yield-guardian

## ✅ On-Chain Proof (Publicly Verifiable)

This is not a mock. Every core interaction is recorded on OPN Testnet and can be verified by anyone:

- **Vault Contract**: [`0x25e0F2b9068295e6b82BB7d4E15B5FE668fB401B`](https://testnet.iopn.tech/address/0x25e0F2b9068295e6b82BB7d4E15B5FE668fB401B)  
- **Stablecoin Used**: tUSDT ([`0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b`](https://testnet.iopn.tech/token/0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b))  
- **Mechanism**:  
  - Deposit tUSDT → triggers `ReputationBoosted(address user, uint256 newREP)`  
  - REP increases → Nexus Tier upgrades → APY scales from **5% → 18%**  
- **Verified Transaction**: [Insert your tx hash here](https://testnet.iopn.tech/tx/0x...)

No off-chain logic. No anonymous farming. Just **sovereign finance, proven on-chain**.

## 🧩 How It Works

1. Connect wallet to **OPN Testnet (Chain ID 984)**  
2. Deposit tUSDT into the vault  
3. Your **on-chain REP updates instantly** (visible in contract state)  
4. Your **APY rises automatically** based on real-time tier  
5. Withdraw anytime — your reputation remains tied to your wallet

Your financial identity *is* your on-chain history.

## 🌐 Tech Stack

- **Frontend**: React + Vite + TypeScript (built with Lovable)  
- **Smart Contract**: Solidity (`SovereignYield.sol`)  
- **Network**: OPN Testnet (Chain ID 984)  
- **Token Standard**: ERC-20 (tUSDT, 6 decimals)  
- **Design**: IOPn-native dark theme (`#0A1F44`, `#3A7BFF`)

## 📦 Local Setup

```bash
git clone https://github.com/duchth1993/sovereign-yield-guardian.git
cd sovereign-yield-guardian
npm install
npm run dev

##Ensure .env contains:##
VITE_SOVEREIGN_YIELD_ADDRESS=0x25e0F2b9068295e6b82BB7d4E15B5FE668fB401B
VITE_STABLECOIN_ADDRESS=0x3e01b4d892E0D0A219eF8BBe7e260a6bc8d9B31b

##🏆 Built for IOPn Builder’s Programme##
Track: DeFi & Open Finance
Core Innovation: Reputation as a composable, on-chain primitive that compounds across financial activity
Sovereign Alignment: All data, identity, and value remain under user control — no intermediaries, no opacity
