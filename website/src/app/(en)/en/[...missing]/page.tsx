import { notFound } from "next/navigation";

// Statický export (FTP hosting) potřebuje aspoň jednu stránku → vznikne <jazyk>/404/index.html,
// na kterou míří ErrorDocument v .htaccess.
export const dynamicParams = false;
export function generateStaticParams() {
  return [{ missing: ["404"] }];
}

export default function Missing() {
  notFound();
}
