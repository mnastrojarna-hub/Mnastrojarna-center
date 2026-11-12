import { QualityView, qualityMeta } from "@/views/pages";

export const metadata = qualityMeta("en");

export default function Page() {
  return <QualityView locale="en" />;
}
