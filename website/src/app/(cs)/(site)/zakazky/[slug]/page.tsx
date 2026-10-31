import { notFound } from "next/navigation";
import { CASES, caseBySlug } from "@/content/cases";
import { CaseView, caseMeta } from "@/views/cases";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;

export function generateStaticParams() {
  return CASES.map((c) => ({ slug: c.slug.cs }));
}

export async function generateMetadata({ params }: Props) {
  const c = caseBySlug("cs", (await params).slug);
  return c ? caseMeta("cs", c) : {};
}

export default async function Page({ params }: Props) {
  const c = caseBySlug("cs", (await params).slug);
  if (!c) notFound();
  return <CaseView locale="cs" c={c} />;
}
