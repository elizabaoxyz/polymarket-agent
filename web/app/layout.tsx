import type { Metadata } from "next";
import { Kode_Mono } from "next/font/google";
import "./globals.css";

const kodeMono = Kode_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "ElizaBAO",
  description: "AI-powered Polymarket trading agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${kodeMono.variable} antialiased bg-[var(--bg)] text-[var(--text)]`}>
        {children}
      </body>
    </html>
  );
}
