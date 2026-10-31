import { AboutView, aboutMeta } from "@/views/pages";

export const metadata = aboutMeta("en");

export default function Page() {
  return <AboutView locale="en" />;
}
