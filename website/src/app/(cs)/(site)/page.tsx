import { HomeView, homeMeta } from "@/views/home";

export const metadata = homeMeta("cs");

export default function Page() {
  return <HomeView locale="cs" />;
}
