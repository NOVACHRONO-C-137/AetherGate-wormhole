# ⬡ AetherGate — Layer-0 Bidirectional Cross-Chain Bridge

> A decentralized, ECDSA-secured, bidirectional asset bridge between EVM networks and Solana.

```
EVM (Sepolia/Mainnet) ←──── AetherGate ────→ Solana (Devnet/Mainnet-Beta)
```

---

## Workspaces

| Folder | Stack | Purpose |
|---|---|---|
| `1-contracts-evm/` | Solidity · Foundry | VaultBridge contract on EVM |
| `2-contracts-solana/` | Rust · Anchor | AetherGate program on Solana |
| `3-relayer-node/` | Node.js · TypeScript | Off-chain relayer daemon |
| `4-frontend/` | Next.js 14 · Tailwind · Framer Motion | Dashboard UI |

---

## Architecture

```
User
 │
 ├─ lockNative() ──────────────────► VaultBridge.sol
 │                                        │  emits Locked event
 │                                        ▼
 │                               Relayer (Node.js)
 │                                        │  verifies & signs
 │                                        ▼
 │                              Anchor Program (Solana)
 │                                   mint_wrapped()
 │                                        │
 │◄─── wrapped SPL token minted ──────────┘
 │
 │                         ── Reverse direction ──
 │
 ├─ burn_wrapped() ─────────────────► Anchor Program
 │                                        │  emits Burned event
 │                                        ▼
 │                               Relayer (Node.js)
 │                                        │  verifies & signs
 │                                        ▼
 │                              VaultBridge.sol
 │                                  unlockNative()
 │◄─── Original ERC-20 / ETH released ───┘
```

## Security Model

- **ECDSA signature verification** on every relayer-submitted transaction
- **Nonce-based replay protection** — each bridge transfer has a unique `bytes32` nonce
- **Role-based access control** — `RELAYER_ROLE`, `PAUSER_ROLE`, `DEFAULT_ADMIN`
- **Reentrancy guard** on all value-moving functions
- **Emergency pause** via `PAUSER_ROLE`
- **PDA-based vault & mint authority** on Solana — no private key holds assets

## Chain ID Scheme (Internal)

| Chain | AetherGate Chain ID |
|---|---|
| Ethereum Mainnet | 1 |
| Ethereum Sepolia | 11155111 |
| Solana Devnet | **101** |
| Solana Mainnet-Beta | 102 |

> ⚠️ **Note:** Chain ID 101 for Solana is AetherGate's internal routing identifier, not a native Solana concept.

## Fee Model

- Default fee: **0.10% (10 bps)**
- Fee is deducted pre-relay on the source chain
- Configurable up to 10% hard cap
- Fee recipient is a multisig address

---

## Quick Start

```bash
# 1. EVM — compile & test
cd 1-contracts-evm
forge install
forge test -vv

# 2. Solana — build Anchor program
cd ../2-contracts-solana
anchor build

# 3. Relayer — install & run
cd ../3-relayer-node
npm install
cp .env.example .env   # fill in your keys
npm run dev

# 4. Frontend — start dev server
cd ../4-frontend
npm install
npm run dev
```

---

*AetherGate is experimental software. Not audited. Use on testnet only.*
