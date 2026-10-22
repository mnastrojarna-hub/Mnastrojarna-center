import Link from "next/link";
import { SearchX, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function JobNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
        <SearchX className="h-8 w-8" />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold">Zakázku jsme nenašli</h1>
        <p className="text-sm text-muted-foreground">
          Možná byla smazána, nebo je odkaz neúplný. Všechny zakázky najdeš v Knize zakázek — hledat můžeš podle čísla,
          zákazníka i čísla výkresu.
        </p>
      </div>
      <Button asChild>
        <Link href="/orders">
          <ArrowLeft className="h-4 w-4" /> Zpět do Knihy zakázek
        </Link>
      </Button>
    </div>
  );
}
