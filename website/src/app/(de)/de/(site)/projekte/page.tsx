import { CasesView, casesMeta } from "@/views/cases";

export const metadata = casesMeta("de");

export default function Page() {
  return <CasesView locale="de" />;
}
