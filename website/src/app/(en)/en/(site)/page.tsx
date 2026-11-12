import { HomeView, homeMeta } from "@/views/home";

export const metadata = homeMeta("en");

export default function Page() {
  return <HomeView locale="en" />;
}
