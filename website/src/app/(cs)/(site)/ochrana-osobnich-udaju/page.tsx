import { PrivacyView, privacyMeta } from "@/views/pages";

export const metadata = privacyMeta("cs");

export default function Page() {
  return <PrivacyView locale="cs" />;
}
