import { RfqView, rfqMeta } from "@/views/rfq";

export const metadata = rfqMeta("de");

export default function Page() {
  return <RfqView locale="de" />;
}
