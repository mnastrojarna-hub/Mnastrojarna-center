import { ContactView, contactMeta } from "@/views/pages";

export const metadata = contactMeta("en");

export default function Page() {
  return <ContactView locale="en" />;
}
