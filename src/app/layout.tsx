import type { Metadata } from "next";
import "./globals.css";
import FloatingPumpLogos from "@/components/FloatingPumpLogos";

export const metadata: Metadata = {
  title: "Pumpscan — pump.fun token holder analysis",
  description:
    "Paste a pump.fun token and get a verdict in 15 seconds. Bundler detection, holder concentration, dev wallet status.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <FloatingPumpLogos />
        {children}
      </body>
    </html>
  );
}
