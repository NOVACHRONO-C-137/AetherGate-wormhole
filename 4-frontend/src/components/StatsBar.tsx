"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const STATS = [
  { label: "Total Volume",    value: "$12.4M",   suffix: "",    color: "text-aether-glow"  },
  { label: "Transfers",       value: "8,291",     suffix: "",    color: "text-aether-cyan"  },
  { label: "Avg Relay Time",  value: "4.3",       suffix: "s",  color: "text-aether-spark" },
  { label: "Active Chains",   value: "2",         suffix: "",    color: "text-aether-gold"  },
  { label: "Relayer Uptime",  value: "99.9",      suffix: "%",  color: "text-aether-glow"  },
];

export default function StatsBar() {
  const [visible, setVisible] = useState(false);
  useEffect(() => { setVisible(true); }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : 20 }}
      transition={{ delay: 0.6, duration: 0.7 }}
      className="relative z-10 max-w-5xl mx-auto px-4 mb-6"
    >
      <div className="glass-card px-4 py-3 flex flex-wrap items-center justify-around gap-4">
        {STATS.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 + i * 0.1 }}
            className="flex flex-col items-center gap-0.5"
          >
            <span className={`text-xl font-display font-bold ${s.color}`}>
              {s.value}<span className="text-sm">{s.suffix}</span>
            </span>
            <span className="text-xs text-white/35 uppercase tracking-wider">{s.label}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
