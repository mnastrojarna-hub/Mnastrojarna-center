import { InboxView } from "./inbox-view";
import { getEmails } from "@/lib/data/queries";

export default async function InboxPage() {
  const emails = await getEmails();
  return <InboxView emails={emails} />;
}
