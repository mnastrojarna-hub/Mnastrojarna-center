import { RootShell, rootMetadata, rootViewport } from "@/components/root-shell";

export const metadata = rootMetadata("cs");
export const viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootShell locale="cs">{children}</RootShell>;
}
