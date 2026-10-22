"use client";

import { X } from "lucide-react";
import { BookLink } from "@/components/jobs/book/book-nav";
import { RESET_FILTERS } from "@/components/jobs/book/book-params";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** „Zrušit filtry" jako odkaz (záložka, řazení a pohled zůstanou). */
export function ResetFiltersButton({ className }: { className?: string }) {
  return (
    <BookLink patch={RESET_FILTERS} className={cn(buttonVariants({ variant: "outline" }), className)}>
      <X /> Zrušit filtry
    </BookLink>
  );
}
