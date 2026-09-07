import type { Metadata, Viewport } from "next";
import { Archivo_Black, Instrument_Serif, Kode_Mono } from "next/font/google";
import "./globals.css";

const kodeMono = Kode_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "700"] });
const archivoBlack = Archivo_Black({ subsets: ["latin"], variable: "--font-display", weight: "400" });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "elizaBAO — accepted prediction data, paid in USDC",
  description:
    "The acceptance layer for prediction markets. Labels bind to snapshots at time T, gates check evidence dates, reviews are adversarial, and USDC pays only work that beats the book.",
  icons: {
    icon: "/eliza-portrait.png",
    apple: "/eliza-portrait.png",
  },
  appleWebApp: {
    capable: true,
    title: "elizaBAO",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#e66516",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${kodeMono.variable} ${archivoBlack.variable} ${instrumentSerif.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
