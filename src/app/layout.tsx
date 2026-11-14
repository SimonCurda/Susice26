import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chladnější kraj — Plzeňský kraj | otevřená data · Copernicus · AI",
  description:
    "Vysvětlitelná AI aplikace proti přehřívání měst: chladné trasy pro občany (kudy projít), hotspoty a návrhy výsadeb pro samosprávu (co vysázet). Open data + Copernicus.",
  keywords: ["otevřená data", "Copernicus", "Plzeňský kraj", "městský ostrov tepla", "chladné trasy", "výsadba stromů", "hackathon"],
  authors: [{ name: "Chladnější kraj" }],
  openGraph: {
    title: "Chladnější kraj — Plzeňský kraj",
    description: "Kudy projít v horku? Co a kam vysázet? Otevřená data + Copernicus + vysvětlitelné AI.",
    siteName: "Chladnější kraj",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
