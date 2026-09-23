import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ItmsProvider } from "@/lib/store";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ITMS — Intelligent Traffic Management",
  description: "AI-powered traffic command center with a predictive rolling green corridor for emergency vehicles.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-[#080B12] text-[#F4F7FA] min-h-screen`}
      >
        <ItmsProvider>
          <AppShell>{children}</AppShell>
        </ItmsProvider>
      </body>
    </html>
  );
}
