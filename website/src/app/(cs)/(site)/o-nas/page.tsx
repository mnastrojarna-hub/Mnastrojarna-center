import { AboutView, aboutMeta } from "@/views/pages";

export const metadata = aboutMeta("cs");

export default function Page() {
  return <AboutView locale="cs" />;
}
