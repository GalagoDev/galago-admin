import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    cpus: 1,
    serverActions: {
      bodySizeLimit: "55mb",
    },
  },
};

export default nextConfig;
