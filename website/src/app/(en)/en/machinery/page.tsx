import { MachineryView, machineryMeta } from "@/views/pages";

export const metadata = machineryMeta("en");

export default function Page() {
  return <MachineryView locale="en" />;
}
