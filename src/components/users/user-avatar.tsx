import { avatarColor, initialsFor, ROLE_STYLES } from "@/components/users/user-style";
import type { UserRole } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/** Barevný avatar s iniciálami; tečka v barvě role, šedý když je účet neaktivní. */
export function UserAvatar({
  id,
  name,
  email,
  role,
  active = true,
  size = "md",
  className,
}: {
  id: string;
  name: string;
  email?: string | null;
  role?: UserRole;
  active?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizes = {
    sm: "h-8 w-8 text-[11px]",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg",
    xl: "h-20 w-20 text-2xl ring-4",
  };
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-full font-semibold shadow-sm ring-2 ring-background",
          sizes[size],
          active ? avatarColor(id || email || name) : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {initialsFor(name, email)}
      </span>
      {role && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-background",
            size === "lg" || size === "xl" ? "h-4 w-4" : "h-3 w-3",
            active ? ROLE_STYLES[role].dot : "bg-muted-foreground/50",
          )}
          aria-hidden
        />
      )}
    </span>
  );
}
