import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

// Brand font dle logomanuálu (varianta písma č. 2 — vhodné pro delší bloky textů)
const roboto = Roboto({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "CNC Sales OS — AI kancelář pro nástrojárnu",
  description:
    "AI asistovaná obchodní kancelář: e-maily, poptávky, nabídky, objednávky, výkresy a provize — automaticky.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <body className={`${roboto.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
