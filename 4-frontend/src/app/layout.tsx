import type { Metadata } from "next";
import { Outfit, Rajdhani, Press_Start_2P } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

const pressStart2P = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-pixel",
  display: "swap",
});

export const metadata: Metadata = {
  title:       "AetherGate — Omnichain Bridge Conduit",
  description: "EVM ↔ Solana bidirectional asset bridge. Lock, Mint, Burn, Unlock across the ætherchain.",
  keywords:    ["cross-chain", "bridge", "solana", "ethereum", "web3", "defi", "layer0", "omnichain"],
  openGraph: {
    title:       "AetherGate — Omnichain Bridge Conduit",
    description: "EVM ↔ Solana bidirectional asset bridge. Lock, Mint, Burn, Unlock across the ætherchain.",
    type:        "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${rajdhani.variable} ${pressStart2P.variable}`}>
      <body className="font-sans bg-black text-white antialiased">
        {children}
      </body>
    </html>
  );
}
