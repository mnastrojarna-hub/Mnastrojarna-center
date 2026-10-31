import Link from "next/link";
import { Icon } from "@/components/icons";

export default function NotFound() {
  return (
    <section className="noise relative grid min-h-[80vh] place-items-center overflow-hidden bg-ink text-white">
      <div className="bg-grid mask-fade absolute inset-0" />
      <div className="container relative text-center">
        <p className="font-mono text-sm text-brand">Chyba 404 · tolerance překročena</p>
        <h1 className="h-display mt-4 text-6xl md:text-8xl">Tahle stránka neexistuje</h1>
        <p className="mx-auto mt-6 max-w-lg text-white/60">Možná byla přesunuta při přestavbě webu. Zkuste úvod nebo nám rovnou pošlete poptávku.</p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/" className="btn-ghost-dark">
            Úvodní stránka
          </Link>
          <Link href="/poptavka" className="btn-primary">
            Poptat výrobu <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
