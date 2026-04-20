/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        aether: {
          void:    "#03030a",
          deep:    "#07071a",
          navy:    "#0d0d2b",
          indigo:  "#1a1a4e",
          pulse:   "#6c63ff",
          glow:    "#a78bfa",
          cyan:    "#22d3ee",
          spark:   "#f0abfc",
          gold:    "#fbbf24",
          danger:  "#f43f5e",
        },
      },
      fontFamily: {
        sans:  ["var(--font-outfit)", "system-ui", "sans-serif"],
        mono:  ["var(--font-jetbrains)", "monospace"],
        display: ["var(--font-rajdhani)", "sans-serif"],
      },
      backgroundImage: {
        "aether-radial":
          "radial-gradient(ellipse 80% 60% at 50% 0%, #1a1a4e 0%, #03030a 70%)",
        "pulse-glow":
          "radial-gradient(circle 400px at 50% 50%, rgba(108,99,255,0.15), transparent)",
        "grid-aether":
          "linear-gradient(rgba(108,99,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(108,99,255,0.07) 1px, transparent 1px)",
      },
      backgroundSize: {
        "grid-sm": "40px 40px",
      },
      keyframes: {
        "float-up":   { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        "pulse-ring":  { "0%": { transform: "scale(1)", opacity: "1" }, "100%": { transform: "scale(2.5)", opacity: "0" } },
        "shimmer":     { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "scan-line":   { "0%": { top: "0%" }, "100%": { top: "100%" } },
        "warp":        { "0%": { opacity: "0", transform: "scaleX(0.5)" }, "100%": { opacity: "1", transform: "scaleX(1)" } },
      },
      animation: {
        "float-up":   "float-up 4s ease-in-out infinite",
        "pulse-ring":  "pulse-ring 2s cubic-bezier(0.4,0,0.6,1) infinite",
        "shimmer":     "shimmer 2.5s linear infinite",
        "scan-line":   "scan-line 3s linear infinite",
        "warp":        "warp 0.4s ease-out forwards",
      },
    },
  },
  plugins: [],
};
