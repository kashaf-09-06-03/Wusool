import type { Metadata, Viewport } from "next";
import { Bagel_Fat_One, Caveat, Gelasio, Instrument_Serif, Libre_Baskerville, Libre_Franklin, Newsreader } from "next/font/google";
import { Providers } from "@/components/shell";
import "./globals.css";

const newsreader = Newsreader({ subsets: ["latin"], weight: ["500"], style: ["normal", "italic"], variable: "--font-newsreader", display: "swap" });
const gelasio = Gelasio({ subsets: ["latin"], weight: ["400"], style: ["normal", "italic"], variable: "--font-gelasio", display: "swap" });
const franklin = Libre_Franklin({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-franklin", display: "swap" });
const bagel = Bagel_Fat_One({ subsets: ["latin"], weight: ["400"], variable: "--font-bagel", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: ["700"], variable: "--font-caveat", display: "swap" });
const instrument = Instrument_Serif({ subsets: ["latin"], weight: ["400"], style: ["italic"], variable: "--font-instrument", display: "swap" });
const baskerville = Libre_Baskerville({ subsets: ["latin"], weight: ["400"], style: ["italic"], variable: "--font-baskerville", display: "swap" });

export const metadata: Metadata = {
  title: "Wusool",
  description: "Tell Wusool what happened. Split a whole outing from receipts and a short story.",
  applicationName: "Wusool",
  icons: { icon: "/assets/star3d-cut.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={[newsreader, gelasio, franklin, bagel, caveat, instrument, baskerville].map((f) => f.variable).join(" ")}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
