import localFont from "next/font/local";

// Roboto hostované přímo s webem (latin + latin-ext) — build nepotřebuje Google Fonts
export const sans = localFont({
  src: [
    { path: "./fonts-local/roboto-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts-local/roboto-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts-local/roboto-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});
export const display = localFont({
  src: [
    { path: "./fonts-local/roboto-condensed-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts-local/roboto-condensed-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts-local/roboto-condensed-800.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});
export const mono = localFont({
  src: [
    { path: "./fonts-local/roboto-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts-local/roboto-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});
