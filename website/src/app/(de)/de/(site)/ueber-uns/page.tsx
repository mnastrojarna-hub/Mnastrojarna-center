import { AboutView, aboutMeta } from "@/views/pages";

export const metadata = aboutMeta("de");

export default function Page() {
  return <AboutView locale="de" />;
}
