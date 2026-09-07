import type { Metadata } from "next";
import { Kode_Mono } from "next/font/google";
import "./globals.css";

const kodeMono = Kode_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "elizaBAO — accepted prediction data, paid in USDC",
  description:
    "An acceptance layer for prediction markets. Labels bind to snapshots at time T, gates check evidence dates, reviews are adversarial, and USDC pays only work that beats the book.",
  icons: {
    icon: "/bao-logo.png",
    apple: "/bao-logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${kodeMono.variable} antialiased bg-[var(--bg)] text-[var(--text)]`}>
        {children}
        <div className="scanline" />
      </body>
    </html>
  );
}
