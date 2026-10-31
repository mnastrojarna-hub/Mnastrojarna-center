import { RootShell, rootMetadata, rootViewport } from "@/components/root-shell";

export const metadata = rootMetadata("de");
export const viewport = rootViewport;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootShell locale="de">{children}</RootShell>;
}
