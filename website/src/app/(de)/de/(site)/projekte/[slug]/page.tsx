import { notFound } from "next/navigation";
import { CASES, caseBySlug } from "@/content/cases";
import { CaseView, caseMeta } from "@/views/cases";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;

export function generateStaticParams() {
  return CASES.map((c) => ({ slug: c.slug.de }));
}

export async function generateMetadata({ params }: Props) {
  const c = caseBySlug("de", (await params).slug);
  return c ? caseMeta("de", c) : {};
}

export default async function Page({ params }: Props) {
  const c = caseBySlug("de", (await params).slug);
  if (!c) notFound();
  return <CaseView locale="de" c={c} />;
}
