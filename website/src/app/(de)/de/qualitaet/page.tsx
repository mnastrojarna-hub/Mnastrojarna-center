import { QualityView, qualityMeta } from "@/views/pages";

export const metadata = qualityMeta("de");

export default function Page() {
  return <QualityView locale="de" />;
}
