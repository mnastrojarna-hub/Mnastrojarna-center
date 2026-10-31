import { ContactView, contactMeta } from "@/views/pages";

export const metadata = contactMeta("cs");

export default function Page() {
  return <ContactView locale="cs" />;
}
