import { CareersView, careersMeta } from "@/views/pages";

export const metadata = careersMeta("de");

export default function Page() {
  return <CareersView locale="de" />;
}
