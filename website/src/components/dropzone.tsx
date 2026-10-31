"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export function Dropzone({
  accept,
  multiple = true,
  onFiles,
  title,
  hint,
  dark,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (f: File[]) => void;
  title: string;
  hint?: string;
  dark?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = Array.from(e.dataTransfer.files);
        if (f.length) onFiles(multiple ? f : f.slice(0, 1));
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all duration-300",
        dark ? "border-white/15 bg-white/[0.03] text-white hover:border-brand/70" : "border-ink-700/15 bg-steel-100 text-ink-700 hover:border-brand/70",
        over && "scale-[1.01] border-brand bg-brand/10",
      )}
    >
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-[0_10px_30px_-8px_rgba(224,57,48,.8)] transition-transform duration-300 group-hover:-translate-y-1">
        <Icon name="upload" />
      </span>
      <p className="text-[16px] font-semibold">{title}</p>
      {hint && <p className={cn("max-w-md text-[13px]", dark ? "text-white/50" : "text-ink-700/55")}>{hint}</p>}
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const f = Array.from(e.target.files ?? []);
          if (f.length) onFiles(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
