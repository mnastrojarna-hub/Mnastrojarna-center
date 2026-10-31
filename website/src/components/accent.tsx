/** Vykreslí text, kde *zvýrazněná část* je v korporátní červené. */
export function Accent({ text }: { text: string }) {
  const parts = text.split(/\*(.+?)\*/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <span key={i} className="text-brand">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

/** Text bez hvězdiček (pro meta tagy, alt, aria). */
export const plain = (text: string) => text.replace(/\*/g, "");
