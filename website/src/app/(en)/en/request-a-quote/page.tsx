import { RfqView, rfqMeta } from "@/views/rfq";

export const metadata = rfqMeta("en");

export default function Page() {
  return <RfqView locale="en" />;
}
