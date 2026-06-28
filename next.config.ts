import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  allowedDevOrigins: [
    "run-agent-6a3bfcb7affb99f5c6659125-mqwlu29k.remote-agent.svc.cluster.local",
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
