import type { Metadata, Viewport } from "next";
import { Bodoni_Moda, Libre_Franklin } from "next/font/google";
import { Providers } from "@/components/shell";
import "./globals.css";

// Headlines: Bodoni Moda (high-contrast magazine serif, optical sizes so 20px and 56px both stay crisp).
// Everything else: Libre Franklin (the Franklin Gothic family newspapers pair with their serif).
const bodoni = Bodoni_Moda({ subsets: ["latin"], axes: ["opsz"], style: ["normal"], variable: "--font-bodoni", display: "swap" });
const franklin = Libre_Franklin({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-franklin", display: "swap" });

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
    <html lang="en" className={[bodoni, franklin].map((f) => f.variable).join(" ")}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
