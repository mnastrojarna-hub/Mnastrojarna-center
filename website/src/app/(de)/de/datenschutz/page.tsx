import { PrivacyView, privacyMeta } from "@/views/pages";

export const metadata = privacyMeta("de");

export default function Page() {
  return <PrivacyView locale="de" />;
}
