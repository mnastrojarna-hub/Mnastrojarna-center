import { ServicesView, servicesMeta } from "@/views/pages";

export const metadata = servicesMeta("cs");

export default function Page() {
  return <ServicesView locale="cs" />;
}
