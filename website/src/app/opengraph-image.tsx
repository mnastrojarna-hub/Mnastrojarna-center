import { ImageResponse } from "next/og";
import { LOGO_BANDS, LOGO_CHIPS } from "@/components/logo-paths";

export const alt = "Mnástrojárna – Váš partner ve strojírenství";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#0F0E0E",
          backgroundImage: "radial-gradient(circle at 85% 20%, rgba(224,57,48,.45), rgba(15,14,14,0) 45%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="110" height="104" viewBox="110 258 66 64">
            {[...LOGO_BANDS, ...LOGO_CHIPS].map((d, i) => (
              <path key={i} d={d} fill="#E03930" />
            ))}
          </svg>
          <div style={{ fontSize: 56, fontWeight: 800 }}>Mnástrojárna</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: "#E03930", letterSpacing: 6, textTransform: "uppercase" }}>Nástrojárna · CNC obrábění · Stroje</div>
          <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1, marginTop: 16, textTransform: "uppercase" }}>Váš partner ve strojírenství</div>
        </div>
        <div style={{ fontSize: 26, color: "rgba(255,255,255,.6)" }}>ISO 9001 & 14001 · 5osé obrábění do Ø 1 000 mm · Pelhřimov</div>
      </div>
    ),
    size,
  );
}
