import { MaintenanceView, maintenanceMeta } from "@/views/pages";

export const metadata = maintenanceMeta("en");

export default function Page() {
  return <MaintenanceView locale="en" />;
}
