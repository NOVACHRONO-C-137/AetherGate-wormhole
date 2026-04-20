"use client";

/**
 * BridgeCard — Intent-Based Bridge UI
 * Aesthetic: Cyber-Glassmorphism (deep teal base, neon lime + orange accents)
 * Design: chamfered corner clip-path, thick lime left border, glassmorphism panels
 */

import { useState, useCallback, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUpDown, ChevronDown, Zap, Info } from "lucide-react";
import clsx from "clsx";

// ── Network / Token config ────────────────────────────────────────────────────

interface Network {
  id:      string;
  name:    string;
  sub:     string;
  logo:    string;
  chainId: number;
  tokens:  string[];
}

const NETWORKS: Network[] = [
  { id: "eth-sep",   name: "Ethereum", sub: "Sepolia",  logo: "🔷", chainId: 11155111, tokens: ["ETH",  "USDC", "WBTC"]  },
  { id: "sol-dev",   name: "Solana",   sub: "Devnet",   logo: "◎",  chainId: 101,      tokens: ["SOL",  "USDC", "BONK"]  },
  { id: "poly-amoy", name: "Polygon",  sub: "Amoy",     logo: "🟣", chainId: 80002,    tokens: ["MATIC","USDC"]           },
  { id: "arb-sep",   name: "Arbitrum", sub: "Sepolia",  logo: "🔵", chainId: 421614,   tokens: ["ETH",  "USDC"]           },
];

const RATE = 0.9975; // simulated 0.25% protocol fee

function computeOutput(amount: string): string {
  const n = parseFloat(amount);
  if (!n || isNaN(n) || n <= 0) return "";
  return (n * RATE).toFixed(6).replace(/\.?0+$/, "");
}

function formatFee(amount: string): string {
  const n = parseFloat(amount);
  if (!n || isNaN(n) || n <= 0) return "—";
  return (n * (1 - RATE)).toFixed(6).replace(/\.?0+$/, "");
}

// ── Network Dropdown ──────────────────────────────────────────────────────────

function NetworkDropdown({
  selected, token, networks, onSelect, onTokenChange, id,
}: {
  selected:      Network;
  token:         string;
  networks:      Network[];
  onSelect:      (n: Network) => void;
  onTokenChange: (t: string) => void;
  id:            string;
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = (n: Network, t?: string) => {
    onSelect(n);
    onTokenChange(t ?? (n.tokens.includes(token) ? token : n.tokens[0]));
    setOpen(false);
  };

  return (
    <div className="relative">
      <motion.button
        id={id}
        type="button"
        onClick={() => setOpen((p) => !p)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        className="cyber-select-btn"
        aria-expanded={open}
      >
        <span className="text-lg leading-none">{selected.logo}</span>
        <div className="flex flex-col items-start leading-none">
          <span className="text-white text-sm font-semibold">{selected.name}</span>
          <span className="text-[#87a4b6] text-[11px]">{selected.sub}</span>
        </div>
        <ChevronDown size={13} className={clsx("text-[#87a4b6] transition-transform ml-0.5", open && "rotate-180")} />
        <span className="ml-1 px-2 py-0.5 rounded text-[11px] font-bold text-white bg-[#cc1500]">{token}</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* Click-outside overlay */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="absolute right-0 top-full mt-2 w-64 cyber-dropdown z-50"
            >
              {networks.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleSelect(n)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                    n.id === selected.id ? "bg-[#ff3a20]/10 text-[#ff6040]" : "text-white hover:bg-[#120000]"
                  )}
                >
                  <span className="text-lg">{n.logo}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold">{n.name}</div>
                    <div className="text-[11px] text-[#87a4b6]">{n.sub} · ID {n.chainId}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {n.tokens.map((t) => (
                      <span
                        key={t}
                        onClick={(e) => { e.stopPropagation(); handleSelect(n, t); }}
                        className={clsx(
                          "text-[10px] px-1.5 py-0.5 rounded border cursor-pointer transition-colors",
                          t === token && n.id === selected.id
                            ? "border-[#ff3a20] text-[#ff6040]"
                            : "border-[#87a4b6]/30 text-[#87a4b6] hover:border-[#ff3a20] hover:text-[#ff6040]"
                        )}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main BridgeCard ───────────────────────────────────────────────────────────

export default function BridgeCard() {
  const formId = useId();

  const [fromNet,   setFromNet]   = useState<Network>(NETWORKS[0]);
  const [toNet,     setToNet]     = useState<Network>(NETWORKS[1]);
  const [fromToken, setFromToken] = useState("ETH");
  const [toToken,   setToToken]   = useState("SOL");
  const [amount,    setAmount]    = useState("");
  const [recipient, setRecipient] = useState("");
  const [fromFocused, setFromFocused] = useState(false);
  const [swapping,  setSwapping]  = useState(false);
  const [status,    setStatus]    = useState<"idle" | "pending" | "success" | "error">("idle");

  const outputAmount = computeOutput(amount);
  const feeAmount    = formatFee(amount);

  const handleSwap = useCallback(() => {
    setSwapping(true);
    setTimeout(() => setSwapping(false), 380);
    setFromNet(toNet);
    setToNet(fromNet);
    setFromToken(toToken);
    setToToken(fromToken);
    if (outputAmount) setAmount(outputAmount);
  }, [toNet, fromNet, toToken, fromToken, outputAmount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    setStatus("pending");
    await new Promise((r) => setTimeout(r, 2400));
    setStatus("success");
    setTimeout(() => setStatus("idle"), 4000);
  };

  const fromNetworks = NETWORKS.filter((n) => n.id !== toNet.id);
  const toNetworks   = NETWORKS.filter((n) => n.id !== fromNet.id);

  return (
    <div className="w-full max-w-[500px] mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45 }}
        className="flex items-center gap-3 mb-5"
      >
        <div className="h-6 w-[5px] rounded-full bg-[#cc1500]" />
        <h2 className="text-white font-bold text-xl tracking-widest uppercase font-display">
          Bridge Assets
        </h2>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-[#87a4b6] border border-[#87a4b6]/20 rounded px-2 py-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ff3a20] animate-pulse" />
          Relayer Live
        </span>
      </motion.div>

      {/* Main card */}
      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="cyber-card"
      >
        {/* ── FROM ── */}
        <motion.div
          className="cyber-section"
          animate={{ borderLeftColor: fromFocused ? "#ff3a20" : "rgba(255,58,32,0)" }}
          transition={{ duration: 0.22 }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#87a4b6] text-[11px] font-semibold uppercase tracking-widest">From</span>
            <NetworkDropdown
              id={`${formId}-from`}
              selected={fromNet}
              token={fromToken}
              networks={fromNetworks}
              onSelect={(n) => { setFromNet(n); setFromToken(n.tokens[0]); }}
              onTokenChange={setFromToken}
            />
          </div>

          <div className="relative pb-1">
            <input
              id={`${formId}-amount`}
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={() => setFromFocused(true)}
              onBlur={() => setFromFocused(false)}
              placeholder="0.00"
              className="cyber-amount-input"
              required
              aria-label="Amount to bridge"
            />
            <span className="absolute right-0 bottom-2 text-[#87a4b6] text-sm font-mono pointer-events-none">
              {fromToken}
            </span>
          </div>

          <div className="flex justify-between items-center mt-1.5 text-[11px] text-[#87a4b6]">
            <span>Balance: —</span>
            <div className="flex gap-1.5">
              {(["25%", "50%", "MAX"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(p === "MAX" ? "1.0" : p === "50%" ? "0.5" : "0.25")}
                  className="cyber-pct-btn"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        {/* ── SWAP BUTTON ── */}
        <div className="relative flex justify-center items-center my-1 z-10">
          <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 h-px bg-[#120000]" />
          <motion.button
            type="button"
            onClick={handleSwap}
            animate={swapping ? { rotate: 180, scale: 0.9 } : { rotate: 0, scale: 1 }}
            whileHover={{ scale: 1.12 }}
            whileTap={{ scale: 0.88 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="cyber-swap-btn relative z-10"
            aria-label="Swap bridge direction"
          >
            <ArrowUpDown size={15} />
          </motion.button>
        </div>

        {/* ── TO ── */}
        <div className="cyber-section">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#87a4b6] text-[11px] font-semibold uppercase tracking-widest">To</span>
            <NetworkDropdown
              id={`${formId}-to`}
              selected={toNet}
              token={toToken}
              networks={toNetworks}
              onSelect={(n) => { setToNet(n); setToToken(n.tokens[0]); }}
              onTokenChange={setToToken}
            />
          </div>

          <div className="relative pb-1">
            <input
              readOnly
              value={outputAmount}
              placeholder="0.00"
              className="cyber-amount-input cursor-not-allowed opacity-60"
              aria-label="Estimated output amount"
            />
            <span className="absolute right-0 bottom-2 text-[#87a4b6] text-sm font-mono pointer-events-none">
              {toToken}
            </span>
          </div>

          <div className="flex justify-between mt-1.5 text-[11px] text-[#87a4b6]">
            <span>Destination balance: —</span>
            <span className="text-[#ff3a20]/60">~$—</span>
          </div>
        </div>

        {/* ── RECIPIENT ── */}
        <div className="mt-3 px-1">
          <label
            htmlFor={`${formId}-recipient`}
            className="block text-[#87a4b6] text-[11px] uppercase tracking-widest mb-1.5"
          >
            Destination Address
          </label>
          <input
            id={`${formId}-recipient`}
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={toNet.id === "sol-dev" ? "Solana pubkey (base58)…" : "0x EVM address…"}
            className="cyber-text-input"
          />
        </div>

        {/* ── FEE BREAKDOWN ── */}
        <AnimatePresence>
          {amount && parseFloat(amount) > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{   opacity: 0, height: 0 }}
              className="overflow-hidden mt-4"
            >
              <div className="rounded border border-[#120000] bg-[#0a0000]/60 divide-y divide-[#120000] text-[12px]">
                {[
                  ["Rate",           `1 ${fromToken} ≈ ${RATE} ${toToken}`],
                  ["Protocol Fee",   `${feeAmount} ${fromToken}  (0.25%)`],
                  ["You Receive",    `${outputAmount || "—"} ${toToken}`],
                  ["Est. Time",      "~5 seconds"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between px-3 py-2">
                    <span className="text-[#87a4b6]">{k}</span>
                    <span className="text-white font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── CTA ── */}
        <motion.button
          type="submit"
          disabled={status === "pending" || !amount || parseFloat(amount) <= 0}
          whileHover={status !== "pending" ? { scale: 1.02 } : {}}
          whileTap={  status !== "pending" ? { scale: 0.97 } : {}}
          className={clsx("cyber-cta-btn mt-5 w-full", status === "pending" && "opacity-80 cursor-wait")}
        >
          <AnimatePresence mode="wait">
            {status === "pending" ? (
              <motion.span key="p" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                Relaying…
              </motion.span>
            ) : status === "success" ? (
              <motion.span key="s" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2">
                <Zap size={15} />
                Relay Submitted!
              </motion.span>
            ) : (
              <motion.span key="i" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-2">
                Bridge Assets
                <span className="text-[#001925]/50 text-xs font-normal">
                  {fromNet.name} → {toNet.name}
                </span>
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Success notice */}
        <AnimatePresence>
          {status === "success" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 flex items-start gap-2 text-[12px] text-[#ff6040] bg-[#ff3a20]/8 border border-[#ff3a20]/20 rounded px-3 py-2.5"
            >
              <Info size={13} className="mt-0.5 shrink-0" />
              Transaction submitted. AetherGate relayer will process in ~5 seconds.
            </motion.div>
          )}
        </AnimatePresence>

        <p className="mt-4 text-center text-[10px] text-[#87a4b6]/40 leading-relaxed">
          AetherGate is experimental. Testnet only. Not audited.
        </p>
      </motion.form>
    </div>
  );
}
