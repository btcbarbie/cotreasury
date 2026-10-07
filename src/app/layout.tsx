import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CoTreasury — a treasury governed by the collective it serves",
  description:
    "Collective goal. Collective treasury. Collective control. AI coordinates, people govern, PayPal moves the money, and the ledger remembers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-surface/80 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-accent to-teal text-[11px] font-bold text-white">
                CT
              </span>
              CoTreasury
            </Link>
            <div id="header-slot" className="flex items-center" />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
