/** UI plošného modelování: ikony příkazů karty „Plochy“ (formuláře vznikají automaticky z `params`). */
import { registerIcon } from "./icons";

const I: Record<string, React.ReactNode> = {
  "surf-extrude": (
    <>
      <path d="M4 17c3-5 6-5 8-5s5 0 8-5" />
      <path d="M4 9c3-5 6-5 8-5s5 0 8-5" opacity=".45" />
      <path d="M4 17V9M12 12V4M20 7v-7" strokeDasharray="1.5 1.5" />
    </>
  ),
  "surf-revolve": (
    <>
      <path d="M12 3v18" strokeDasharray="2 2" />
      <path d="M6 5c2 3 2 11 0 14" />
      <path d="M18 5c-2 3-2 11 0 14" opacity=".45" />
      <path d="M6 19a6 2 0 0 0 12 0" />
    </>
  ),
  "surf-planar": (
    <>
      <path d="M3 16l6-9h12l-6 9z" />
      <path d="M8 13h8" opacity=".45" />
    </>
  ),
  "surf-sweep": (
    <>
      <path d="M4 19c2-8 8-6 10-12" strokeDasharray="2 1.5" />
      <path d="M11 6a3 2 0 0 1 6 0" />
      <path d="M8 13a3 2 0 0 1 6 0" opacity=".6" />
      <path d="M5 19a3 2 0 0 1 6 0" opacity=".35" />
    </>
  ),
  "surf-loft": (
    <>
      <path d="M4 18h7" />
      <path d="M13 6a3 2 0 0 1 6 0" />
      <path d="M4 18L13 6M11 18l8-12" opacity=".5" />
    </>
  ),
  "surf-offset": (
    <>
      <path d="M4 14c3-4 6-4 8-4s5 0 8-4" />
      <path d="M4 20c3-4 6-4 8-4s5 0 8-4" opacity=".5" />
      <path d="M12 10v6M20 6v4M4 14v6" strokeDasharray="1.2 1.2" />
    </>
  ),
  "surf-extend": (
    <>
      <path d="M4 16l6-8h6l-6 8z" />
      <path d="M16 8h4l-6 8h-4" strokeDasharray="2 1.5" />
      <path d="M17 4l3 4-3 4" />
    </>
  ),
  "surf-trim": (
    <>
      <path d="M3 16l6-9h12l-6 9z" />
      <path d="M12 3v18" />
      <path d="M12 3l6 4v9l-6 4" opacity=".3" />
    </>
  ),
  "surf-trim-sketch": (
    <>
      <path d="M3 16l6-9h12l-6 9z" />
      <circle cx="12" cy="12" r="3" strokeDasharray="1.5 1.5" />
    </>
  ),
  "surf-sew": (
    <>
      <path d="M3 15l5-7h5l-5 7zM11 15l5-7h5l-5 7z" />
      <path d="M11 9l-1 1M10 12l-1 1M9 15l-1 1" strokeWidth="2" />
    </>
  ),
  "surf-close": (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      <path d="M9 11l2 2 4-4" strokeWidth="2" />
    </>
  ),
  "surf-thicken": (
    <>
      <path d="M3 10l6-6h12l-6 6z" />
      <path d="M3 10v5l6 6h12v-5M9 15l-6-5M9 15v6M21 10l-6 5" opacity=".7" />
    </>
  ),
  "surf-split": (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M2 11h20" strokeDasharray="2.5 1.5" />
      <path d="M4 14l8 4 8-4" opacity=".4" />
    </>
  ),
  "surf-replace": (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M12 12v9M4 8l8 4 8-4" />
      <path d="M12 6V1M9 3l3-2 3 2" strokeWidth="1.8" />
    </>
  ),
  "surf-patch": (
    <>
      <path d="M4 6c4-3 12-3 16 0v12c-4 3-12 3-16 0z" />
      <path d="M8 9c3-1 5-1 8 0M8 15c3 1 5 1 8 0" opacity=".45" />
    </>
  ),
  "surf-section": (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" opacity=".35" />
      <path d="M4 12l8 4 8-4-8-4z" strokeWidth="2" />
    </>
  ),
  "surf-project": (
    <>
      <path d="M3 17l6-7h12l-6 7z" />
      <circle cx="11" cy="6" r="3" strokeDasharray="1.5 1.5" />
      <path d="M11 9v4" strokeDasharray="1 1.2" />
      <ellipse cx="12" cy="13.5" rx="3" ry="1.3" />
    </>
  ),
  "surf-helix": (
    <>
      <path d="M6 4c6 0 6 4 0 4s-6 4 0 4-6 4 0 4-6 4 0 4" />
      <path d="M6 4c-6 0-6 4 0 4s6 4 0 4-6 4 0 4 6 4 0 4" opacity=".4" />
    </>
  ),
  "surf-helix-sweep": (
    <>
      <path d="M12 3v18" strokeDasharray="1.5 1.5" />
      <path d="M7 5l10 2M7 9l10 2M7 13l10 2M7 17l10 2" />
      <path d="M7 5v14M17 7v14" />
    </>
  ),
};

for (const [name, node] of Object.entries(I)) registerIcon(name, node);

export {};
