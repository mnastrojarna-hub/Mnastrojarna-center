import { SiteChrome } from "@/components/site-chrome";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome locale="cs">{children}</SiteChrome>;
}
