import { ReferencesView, referencesMeta } from "@/views/pages";

export const metadata = referencesMeta("en");

export default function Page() {
  return <ReferencesView locale="en" />;
}
