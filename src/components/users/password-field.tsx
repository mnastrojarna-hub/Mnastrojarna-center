"use client";

import * as React from "react";
import { Check, Copy, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/account/password-input";
import { generatePassword } from "@/components/users/password-tools";

/** Zkopíruje text do schránky (s fallbackem pro starší prohlížeče). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback níže
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Tlačítko „Zkopírovat" s krátkým potvrzením. */
export function CopyButton({ text, label = "Zkopírovat", disabled }: { text: string; label?: string; disabled?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || !text}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }
      }}
    >
      {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      {copied ? "Zkopírováno" : label}
    </Button>
  );
}

/** Heslo pro nový účet / nastavení hesla: generátor čitelného hesla + kopírování. */
export function PasswordField({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="space-y-2">
      <PasswordInput
        id={id}
        autoComplete="new-password"
        placeholder="alespoň 8 znaků"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        visible={visible}
        onVisibleChange={setVisible}
        autoFocus={autoFocus}
        className="font-mono"
        showStrength
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            onChange(generatePassword(12));
            setVisible(true);
          }}
        >
          <Wand2 className="h-4 w-4 text-violet-500" /> Vygenerovat
        </Button>
        <CopyButton text={value} />
      </div>
    </div>
  );
}
