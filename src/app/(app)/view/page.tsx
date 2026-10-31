import { StandaloneViewer } from "@/components/file-viewer/standalone-viewer";

export const dynamic = "force-dynamic";

/** Samostatná stránka prohlížeče (otevření dokumentu / 3D modelu v novém okně). */
export default async function ViewPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = (await props.searchParams) ?? {};
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return <StandaloneViewer src={one(sp.src)} name={one(sp.name)} />;
}
