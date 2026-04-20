"use client";

import Link from "next/link";
import AetherGateAnimation from "@/components/AetherGateAnimation";

export default function LandingPage() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#050000]">

      {/* ── Background Animation ── */}
      <div className="absolute inset-0 z-0">
        <AetherGateAnimation />
      </div>

      {/* ── Foreground Content ── */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full pointer-events-none">

        <h1
          className="select-none uppercase text-center leading-snug"
          style={{
            fontFamily: "var(--font-pixel), monospace",
            fontSize: "clamp(1.6rem, 4.5vw, 4rem)",
            letterSpacing: "0.08em",
            color: "#ffffff",
            textShadow: [
              /* ── Red inner stroke (full 8-direction outline) ── */
              "-2px -2px 0 #cc1500",
              " 2px -2px 0 #cc1500",
              "-2px  2px 0 #cc1500",
              " 2px  2px 0 #cc1500",
              "-2px  0   0 #cc1500",
              " 2px  0   0 #cc1500",
              " 0   -2px 0 #cc1500",
              " 0    2px 0 #cc1500",
              /* ── Cyan split — horizontal chromatic offset ── */
              "-5px  0   0 rgba(34,211,238,0.75)",
              " 5px  0   0 rgba(34,211,238,0.75)",
              /* ── Lime split — vertical chromatic offset ── */
              " 0   -5px 0 rgba(202,244,56,0.60)",
              " 0    5px 0 rgba(202,244,56,0.60)",
              /* ── Red bloom glow ── */
              "0 0 18px rgba(255,50,20,0.65)",
              "0 0 45px rgba(200,15,5,0.35)",
            ].join(","),
          }}
        >
          AETHERGATE
        </h1>

        <p
          className="mt-3 text-sm md:text-base font-light tracking-[0.25em] uppercase select-none"
          style={{ color: "rgba(255, 180, 170, 0.55)" }}
        >
          Bridge tokens through the aether
        </p>

        {/* CTA ── Link to /bridge */}
        <Link
          href="/bridge"
          className="pointer-events-auto mt-10 px-12 py-4 rounded-full text-sm font-normal tracking-[0.2em] uppercase cursor-pointer transition-all duration-[400ms]"
          style={{
            background:
              "linear-gradient(135deg, rgba(200, 40, 30, 0.15), rgba(255, 80, 50, 0.15))",
            border: "1px solid rgba(255, 80, 60, 0.3)",
            color: "#ffb8b0",
            backdropFilter: "blur(20px)",
            boxShadow:
              "0 0 30px rgba(200, 40, 30, 0.15), inset 0 0 30px rgba(200, 40, 30, 0.05)",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget;
            el.style.background =
              "linear-gradient(135deg, rgba(200, 40, 30, 0.35), rgba(255, 80, 50, 0.35))";
            el.style.boxShadow =
              "0 0 50px rgba(200, 40, 30, 0.4), inset 0 0 30px rgba(200, 40, 30, 0.1)";
            el.style.borderColor = "rgba(255, 80, 60, 0.6)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.background =
              "linear-gradient(135deg, rgba(200, 40, 30, 0.15), rgba(255, 80, 50, 0.15))";
            el.style.boxShadow =
              "0 0 30px rgba(200, 40, 30, 0.15), inset 0 0 30px rgba(200, 40, 30, 0.05)";
            el.style.borderColor = "rgba(255, 80, 60, 0.3)";
          }}
        >
          Enter the Gate
        </Link>
      </div>
    </main>
  );
}
