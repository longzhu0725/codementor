import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeMentor — 多智能体 AI 算法导师",
  description:
    "CodeMentor 是一个多智能体 AI 算法辅导系统，融合苏格拉底式引导、自适应练习、代码评估与个性化学习路径规划。",
  keywords: [
    "算法学习",
    "AI 导师",
    "编程练习",
    "数据结构",
    "算法竞赛",
    "面试准备",
  ],
  authors: [{ name: "CodeMentor" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
      style={{
        // System font stack to avoid external network requests at build time.
        ['--font-sans' as string]: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', sans-serif",
        ['--font-mono' as string]: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
      }}
    >
      <head>
        {/* Pixel art font — loaded at runtime (not build time) to avoid network issues */}
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-background text-foreground" style={{ fontFamily: 'var(--font-sans)' }}>
        {/* Subtle CRT scanline overlay for retro feel */}
        <div className="crt-overlay" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
