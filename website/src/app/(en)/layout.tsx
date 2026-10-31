import { RootShell, rootMetadata, rootViewport } from "@/components/root-shell";

export const metadata = rootMetadata("en");
export const viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootShell locale="en">{children}</RootShell>;
}
