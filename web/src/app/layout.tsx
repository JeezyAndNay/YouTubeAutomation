import type { Metadata } from "next";
import { Cinzel, Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import QueryProvider from "@/components/QueryProvider";

const cinzel = Cinzel({
  subsets: ["latin"],
  variable: "--font-cinzel",
  weight: ["400", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Ruins Untold — Pipeline",
  description: "Episode pipeline management for Ruins Untold",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${cinzel.variable} ${inter.variable} h-full`}
    >
      <body className="h-full flex antialiased">
        <QueryProvider>
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-abyss">
            {children}
          </main>
        </QueryProvider>
      </body>
    </html>
  );
}
