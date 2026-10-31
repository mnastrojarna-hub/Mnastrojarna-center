import { notFound } from "next/navigation";
import { SERVICE_IDS, serviceSlug } from "@/i18n/config";
import { ServiceView, serviceMeta } from "@/views/pages";

type Props = { params: Promise<{ slug: string }> };
export const dynamicParams = false;

const byslug = (slug: string) => SERVICE_IDS.find((id) => serviceSlug("de", id) === slug);

export function generateStaticParams() {
  return SERVICE_IDS.map((id) => ({ slug: serviceSlug("de", id) }));
}

export async function generateMetadata({ params }: Props) {
  const id = byslug((await params).slug);
  return id ? serviceMeta("de", id) : {};
}

export default async function Page({ params }: Props) {
  const id = byslug((await params).slug);
  if (!id) notFound();
  return <ServiceView locale="de" id={id} />;
}
