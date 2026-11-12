import { CareersView, careersMeta } from "@/views/pages";

export const metadata = careersMeta("en");

export default function Page() {
  return <CareersView locale="en" />;
}
