import { ServicesView, servicesMeta } from "@/views/pages";

export const metadata = servicesMeta("en");

export default function Page() {
  return <ServicesView locale="en" />;
}
