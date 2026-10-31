import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "1.25rem", md: "2rem" }, screens: { "2xl": "1320px" } },
    extend: {
      colors: {
        brand: { DEFAULT: "#E03930", 600: "#C92E26", 400: "#F0574F", glow: "#FF4A3D" },
        ink: { DEFAULT: "#0F0E0E", 900: "#141213", 800: "#1B1919", 700: "#272425", 600: "#36323333" },
        steel: { DEFAULT: "#6C6D6F", 100: "#F3F3F2", 200: "#E6E6E4", 300: "#C9CACB", 400: "#9A9B9D", 500: "#6C6D6F" },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "band-in": { "0%": { transform: "translateX(-40px)", opacity: "0" }, "100%": { transform: "none", opacity: "1" } },
        "chip-out": {
          "0%": { transform: "translate(18px,-14px) scale(.2)", opacity: "0" },
          "60%": { opacity: "1" },
          "100%": { transform: "none", opacity: "1" },
        },
        "glow-pulse": { "0%,100%": { opacity: ".35" }, "50%": { opacity: ".8" } },
        marquee: { "0%": { transform: "translateX(0)" }, "100%": { transform: "translateX(-50%)" } },
        "scan": { "0%": { transform: "translateY(-100%)" }, "100%": { transform: "translateY(100%)" } },
        "fade-up": { "0%": { opacity: "0", transform: "translateY(16px)" }, "100%": { opacity: "1", transform: "none" } },
      },
      animation: {
        marquee: "marquee 40s linear infinite",
        "glow-pulse": "glow-pulse 3.2s ease-in-out infinite",
        scan: "scan 6s linear infinite",
        "fade-up": "fade-up .8s cubic-bezier(.2,.7,.2,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
