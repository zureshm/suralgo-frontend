import type { Metadata } from "next";
import { Poppins, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TradeStoreProvider } from "./store/TradeStore";
import { WatchlistProvider } from "./store/WatchlistContext";
import { StrategyTimerProvider } from "./components/StrategyTimerProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ServiceWorkerRegistrar } from "./components/ServiceWorkerRegistrar";

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SurAlgoApp",
  description: "SurAlgo Trading Application",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#592826" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body
        className={`${poppins.variable} ${geistMono.variable} antialiased`}
      >
        <ServiceWorkerRegistrar />
        <ThemeProvider>
          <TradeStoreProvider>
            <StrategyTimerProvider>
              <WatchlistProvider>
                <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
                  {children}
                </div>
              </WatchlistProvider>
            </StrategyTimerProvider>
          </TradeStoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
