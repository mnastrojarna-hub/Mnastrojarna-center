import { PageHeader } from "@/components/page-header";
import { SentList } from "@/components/sent-list";
import { getSentLog } from "@/lib/data/queries";

export default async function SentPage() {
  const items = await getSentLog();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Odeslaná pošta"
        description="Vše, co odešlo ven — schválené člověkem i odeslané plnou automatikou. Tady zkontroluješ, co přesně systém posílá."
      />
      <SentList items={items} />
    </div>
  );
}
