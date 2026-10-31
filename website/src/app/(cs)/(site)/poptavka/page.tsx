import { RfqView, rfqMeta } from "@/views/rfq";

export const metadata = rfqMeta("cs");

export default function Page() {
  return <RfqView locale="cs" />;
}
