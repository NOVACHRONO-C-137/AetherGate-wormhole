
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next 16 uses 'use cache' and stable Turbopack by default
  experimental: {
    // You can keep your specific package optimizations here
    optimizePackageImports: ["framer-motion", "lucide-react"],
  },
};

export default nextConfig;