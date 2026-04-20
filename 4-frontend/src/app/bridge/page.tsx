"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import DualConnectBar from "@/components/DualConnectBar";
import BridgePanel from "@/components/BridgePanel";

// ── Bridge App Page ────────────────────────────────────────────────────────────
export default function BridgePage() {
  return (
    <main className="relative min-h-screen bg-[#050000] overflow-x-hidden">

      {/* ── Ambient glow — crimson theme ── */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-[#cc1500]/[0.06] blur-[130px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-[#ff3a20]/[0.04] blur-[110px]" />
      </div>

      {/* ── Navigation bar ── */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-50 w-full border-b border-white/[0.04]"
        style={{ background: "rgba(5,0,0,0.75)", backdropFilter: "blur(20px)" }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">

          {/* Left: Logo + back link */}
          <div className="flex items-center gap-6">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="relative w-8 h-8 flex-shrink-0">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 rounded-full border border-[#ff3a20]/40"
                />
                <div className="absolute inset-1.5 rounded-full bg-gradient-to-br from-[#cc1500] to-[#ff6040]" />
              </div>
              <span
                className="text-lg font-bold tracking-widest text-white uppercase"
                style={{ fontFamily: "var(--font-pixel), monospace", fontSize: "0.9rem" }}
              >
                AETHERGATE
              </span>
            </Link>

            {/* Divider */}
            <span className="hidden sm:block w-px h-5 bg-white/10" />

            {/* Back to landing */}
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase transition-colors"
              style={{ color: "rgba(255,150,140,0.45)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,200,190,0.85)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,150,140,0.45)")}
            >
              <ArrowLeft size={12} />
              Back
            </Link>
          </div>

          {/* Centre: page label */}
          <span
            className="text-xs font-semibold tracking-[0.2em] uppercase"
            style={{ color: "rgba(255,150,140,0.3)", fontFamily: "monospace" }}
          >
            Bridge
          </span>

          {/* Right: wallet connect */}
          <div className="flex items-center gap-3">
            {/* Live badge */}
            <span
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold tracking-widest uppercase"
              style={{
                background: "rgba(200,40,30,0.12)",
                border: "1px solid rgba(255,80,60,0.3)",
                color: "rgba(255,180,170,0.8)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff3a20] animate-pulse" />
              Live
            </span>
            <DualConnectBar />
          </div>
        </div>
      </motion.header>

      {/* ── Bridge Card ── */}
      <section className="relative z-10 flex items-center justify-center min-h-[calc(100vh-73px)] px-4 py-12">
        <motion.div
          className="w-full max-w-xl"
          initial={{ opacity: 0, y: 48 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
        >
          <BridgePanel />
        </motion.div>
      </section>

      {/* ── Subtle footer ── */}
      <footer
        className="relative z-10 border-t border-white/[0.04] py-5 px-6 text-center text-xs tracking-wide"
        style={{ color: "rgba(255,150,140,0.25)" }}
      >
        AetherGate Protocol &middot; EVM ↔ Solana &middot; Not audited — Devnet/Testnet only
      </footer>
    </main>
  );
}
