import { CareersView, careersMeta } from "@/views/pages";

export const metadata = careersMeta("cs");

export default function Page() {
  return <CareersView locale="cs" />;
}
