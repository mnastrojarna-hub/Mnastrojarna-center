import { MachineryView, machineryMeta } from "@/views/pages";

export const metadata = machineryMeta("de");

export default function Page() {
  return <MachineryView locale="de" />;
}
