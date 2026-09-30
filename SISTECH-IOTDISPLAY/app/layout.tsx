import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dhaara CRPD — Connected Roadside Priority Display",
  description: "Connected Roadside Priority Display (CRPD) for Intelligent Traffic Management System",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "dhaara CRPD",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark bg-black">
      <body className="antialiased min-h-screen bg-black text-white overflow-hidden">
        {children}
      </body>
    </html>
  );
}
