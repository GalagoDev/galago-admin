import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./scripts/read-nalto-import-payments.php", "./scripts/read-import-invoice.mjs", "./node_modules/pdfjs-dist/legacy/build/pdf*.mjs"],
  },
  experimental: {
    cpus: 1,
    serverActions: {
      bodySizeLimit: "55mb",
    },
  },
};

export default nextConfig;
