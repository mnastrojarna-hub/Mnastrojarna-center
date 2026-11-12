import { HomeView, homeMeta } from "@/views/home";

export const metadata = homeMeta("de");

export default function Page() {
  return <HomeView locale="de" />;
}
