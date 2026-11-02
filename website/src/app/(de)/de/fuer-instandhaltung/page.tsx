import { MaintenanceView, maintenanceMeta } from "@/views/pages";

export const metadata = maintenanceMeta("de");

export default function Page() {
  return <MaintenanceView locale="de" />;
}
