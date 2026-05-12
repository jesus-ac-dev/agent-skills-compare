import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { ResumableBadge } from "@/components/resumable-badge";
import { ProviderSelect } from "@/components/provider-select";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Agentic Repo Explorer",
  description: "Discover agents, skills and workflows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <header className="border-b bg-white">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <Link href="/" className="font-bold text-xl">
              Agentic Explorer
            </Link>
            <nav className="flex items-center gap-6">
              <ProviderSelect />
              <Link href="/" className="text-sm font-medium hover:underline">
                Analyses
              </Link>
              <Link href="/stats" className="text-sm font-medium hover:underline">
                Stats
              </Link>
              <ResumableBadge />
            </nav>
          </div>
        </header>
        <main className="container mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
