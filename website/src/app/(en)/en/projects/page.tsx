import { CasesView, casesMeta } from "@/views/cases";

export const metadata = casesMeta("en");

export default function Page() {
  return <CasesView locale="en" />;
}
