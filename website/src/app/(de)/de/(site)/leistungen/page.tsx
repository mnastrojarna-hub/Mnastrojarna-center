import { ServicesView, servicesMeta } from "@/views/pages";

export const metadata = servicesMeta("de");

export default function Page() {
  return <ServicesView locale="de" />;
}
