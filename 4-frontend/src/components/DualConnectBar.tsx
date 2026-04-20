"use client";

/**
 * DualConnectBar — EVM + Solana wallet connection in a single unified bar.
 * Uses MetaMask (ethers.js) for EVM and Phantom (window.solana) for Solana.
 */

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, ChevronDown, LogOut, Copy, Check } from "lucide-react";
import { ethers } from "ethers";

interface WalletState {
  address: string;
  shortAddr: string;
  balance: string;
  chainName: string;
}

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ── EVM Hook ──────────────────────────────────────────────────────────────────
function useEvmWallet() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    if (!window.ethereum) return alert("Install MetaMask");
    setConnecting(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);
      const signer   = await provider.getSigner();
      const balance  = await provider.getBalance(accounts[0]);
      const network  = await provider.getNetwork();
      setWallet({
        address:   accounts[0],
        shortAddr: shorten(accounts[0]),
        balance:   parseFloat(ethers.formatEther(balance)).toFixed(4),
        chainName: network.name,
      });
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setWallet(null), []);
  return { wallet, connecting, connect, disconnect };
}

// ── Solana Hook ───────────────────────────────────────────────────────────────
function useSolanaWallet() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    const phantom = (window as any).solana;
    if (!phantom?.isPhantom) return alert("Install Phantom wallet");
    setConnecting(true);
    try {
      const resp    = await phantom.connect();
      const pubkey  = resp.publicKey.toString();
      setWallet({
        address:   pubkey,
        shortAddr: shorten(pubkey),
        balance:   "—",
        chainName: "Solana Devnet",
      });
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await (window as any).solana?.disconnect();
    setWallet(null);
  }, []);

  return { wallet, connecting, connect, disconnect };
}

// ── Wallet Pill ───────────────────────────────────────────────────────────────
function WalletPill({
  label, logo, wallet, connecting, onConnect, onDisconnect,
}: {
  label: string;
  logo: string;
  wallet: WalletState | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(wallet!.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      {wallet ? (
        <motion.button
          onClick={() => setOpen((p) => !p)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-3 py-2 rounded-xl glass-card border-aether-pulse/20 text-sm font-medium"
        >
          <span className="text-base">{logo}</span>
          <span className="text-white/80">{wallet.shortAddr}</span>
          <ChevronDown
            size={14}
            className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </motion.button>
      ) : (
        <motion.button
          onClick={onConnect}
          disabled={connecting}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="py-2 px-4 text-xs inline-flex items-center gap-2 font-semibold tracking-widest uppercase cursor-pointer transition-all"
          style={{
            fontFamily: "monospace",
            color: "#ffb8b0",
            background: "linear-gradient(135deg, rgba(180,30,20,0.15), rgba(255,60,40,0.12))",
            border: "1px solid rgba(255,80,60,0.3)",
            borderRadius: "6px",
            backdropFilter: "blur(12px)",
          }}
        >
          {connecting ? (
            <span className="w-3 h-3 border border-[#ffb8b0] border-t-transparent rounded-full animate-spin" />
          ) : (
            <Wallet size={13} />
          )}
          {connecting ? "Connecting…" : `Connect ${label}`}
        </motion.button>
      )}

      <AnimatePresence>
        {open && wallet && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="absolute right-0 top-full mt-2 w-56 glass-card p-3 z-50 space-y-2"
          >
            <div className="text-xs text-white/40 font-medium uppercase tracking-wider">{label}</div>
            <div className="text-xs font-mono break-all" style={{ color: "rgba(255,180,170,0.85)" }}>{wallet.shortAddr}</div>
            <div className="text-xs text-white/40">{wallet.chainName} · {wallet.balance} ETH</div>
            <div className="section-divider my-2" />
            <button
              onClick={copy}
              className="w-full flex items-center gap-2 text-xs text-white/60 hover:text-white py-1"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied!" : "Copy Address"}
            </button>
            <button
              onClick={() => { onDisconnect(); setOpen(false); }}
              className="w-full flex items-center gap-2 text-xs py-1 transition-colors"
              style={{ color: "rgba(255,100,80,0.7)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ff6040")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,100,80,0.7)")}
            >
              <LogOut size={12} /> Disconnect
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function DualConnectBar() {
  const evm    = useEvmWallet();
  const solana = useSolanaWallet();

  return (
    <div className="flex items-center gap-2">
      <WalletPill
        label="EVM"
        logo="🔷"
        wallet={evm.wallet}
        connecting={evm.connecting}
        onConnect={evm.connect}
        onDisconnect={evm.disconnect}
      />
      <WalletPill
        label="Solana"
        logo="◎"
        wallet={solana.wallet}
        connecting={solana.connecting}
        onConnect={solana.connect}
        onDisconnect={solana.disconnect}
      />
    </div>
  );
}
