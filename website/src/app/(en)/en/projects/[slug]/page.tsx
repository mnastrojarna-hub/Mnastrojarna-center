import { notFound } from "next/navigation";
import { CASES, caseBySlug } from "@/content/cases";
import { CaseView, caseMeta } from "@/views/cases";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;

export function generateStaticParams() {
  return CASES.map((c) => ({ slug: c.slug.en }));
}

export async function generateMetadata({ params }: Props) {
  const c = caseBySlug("en", (await params).slug);
  return c ? caseMeta("en", c) : {};
}

export default async function Page({ params }: Props) {
  const c = caseBySlug("en", (await params).slug);
  if (!c) notFound();
  return <CaseView locale="en" c={c} />;
}
