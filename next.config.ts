import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 部署：使用默认 standalone 模式，API 路由 (/api/chat) 可正常运行
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;
