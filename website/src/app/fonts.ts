import { Roboto, Roboto_Condensed, Roboto_Mono } from "next/font/google";

export const sans = Roboto({ subsets: ["latin", "latin-ext"], weight: ["300", "400", "500", "700"], variable: "--font-sans", display: "swap" });
export const display = Roboto_Condensed({ subsets: ["latin", "latin-ext"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });
export const mono = Roboto_Mono({ subsets: ["latin", "latin-ext"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });
