import { MaintenanceView, maintenanceMeta } from "@/views/pages";

export const metadata = maintenanceMeta("cs");

export default function Page() {
  return <MaintenanceView locale="cs" />;
}
