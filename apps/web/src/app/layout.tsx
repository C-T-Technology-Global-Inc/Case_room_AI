import { Toaster } from "@ccr/ui/components/sonner";
import { TooltipProvider } from "@ccr/ui/components/tooltip";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Clinical Case Room", template: "%s · Clinical Case Room" },
  description: "Multiplayer AI for clinical teams: shared patient context, evidence-grounded AI and human-approved decisions.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f8fafc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans text-sm">
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
