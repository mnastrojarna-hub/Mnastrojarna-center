import { ContactView, contactMeta } from "@/views/pages";

export const metadata = contactMeta("de");

export default function Page() {
  return <ContactView locale="de" />;
}
