import { CasesView, casesMeta } from "@/views/cases";

export const metadata = casesMeta("cs");

export default function Page() {
  return <CasesView locale="cs" />;
}
