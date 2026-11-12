import { ReferencesView, referencesMeta } from "@/views/pages";

export const metadata = referencesMeta("de");

export default function Page() {
  return <ReferencesView locale="de" />;
}
