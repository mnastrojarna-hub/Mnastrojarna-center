/**
 * Prémioví zákazníci (9. 11.) — majitel: „Musí to být u všech, jak u poptávek, tak u nabídek, aby bylo jasno,
 * že jsou to přednostní věci, které se musí řešit hned." V pracovních seznamech toku (Poptávky, Nacenění,
 * Nabídky, Potvrzení objednávek, Objednávky dodavatelům, Ke schválení, přehled) jdou položky prémiových
 * zákazníků NAHORU — stabilně, jinak beze změny dosavadního pořadí. Kniha zakázek pořadí nemění (jen chip „Prémioví").
 */
export function premiumFirst<T>(items: readonly T[], isPremium: (item: T) => boolean | null | undefined): T[] {
  const top: T[] = [];
  const rest: T[] = [];
  for (const it of items) (isPremium(it) === true ? top : rest).push(it);
  return top.length ? [...top, ...rest] : [...items];
}
