import { PrivacyView, privacyMeta } from "@/views/pages";

export const metadata = privacyMeta("en");

export default function Page() {
  return <PrivacyView locale="en" />;
}
