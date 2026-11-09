import type { ClaimReason, JobStage, LostReason } from "@/lib/supabase/database.types";
import { flowRank } from "@/lib/jobs/flow-status";
import { fold } from "@/lib/email/job-instructions";

/**
 * Pošta → speciální stav zakázky (majitel 9. 11.: „Stejně by to mělo tyto stavy umět přečíst z pošty a
 * automaticky přiřadit k zakázkám" + „samozřejmě s korekcí"). Čistá logika sdílená serverem i klientem:
 *  - pravidla (CZ / DE / EN klíčová slova) jako záloha a pojistka AI klasifikace pošty,
 *  - spojení výstupu AI (`job_signal`) s pravidly → druh, důvod, jistota,
 *  - co sedí na aktuální stav zakázky (nerealizováno jen před objednávkou, zrušeno jen po objednávce před
 *    dodáním, reklamace ve výrobě / po dodání, pokračovat jen z pozastavení, vyřízení jen otevřené reklamace),
 *  - rozhodnutí automaticky / ke schválení / nic.
 * Dodavatel stav zakázky zákazníka nikdy nemění (zpoždění dodavatele není „pozastaveno").
 */

export type MailStageKind = "reklamace" | "nerealizovano" | "zruseno" | "pozastaveno" | "pokracovat" | "reklamace_vyrizena";

export const MAIL_STAGE_KINDS: MailStageKind[] = ["reklamace", "nerealizovano", "zruseno", "pozastaveno", "pokracovat", "reklamace_vyrizena"];

export function isMailStageKind(v: unknown): v is MailStageKind {
  return typeof v === "string" && (MAIL_STAGE_KINDS as string[]).includes(v);
}

export const MAIL_STAGE_META: Record<MailStageKind, {
  /** „Reklamace" — název do výběru. */
  label: string;
  /** „naznačuje reklamaci (zakázky Z-…)" — věta do návrhu. */
  hint: string;
  /** Tlačítko „Přepnout zakázku do Reklamace". */
  action: string;
}> = {
  reklamace: { label: "Reklamace", hint: "reklamaci", action: "Přepnout zakázku do Reklamace" },
  nerealizovano: { label: "Nerealizováno", hint: "odmítnutí nabídky", action: "Uzavřít jako Nerealizováno" },
  zruseno: { label: "Zrušeno", hint: "storno objednávky", action: "Přepnout zakázku do Zrušeno" },
  pozastaveno: { label: "Pozastaveno", hint: "pozastavení", action: "Pozastavit zakázku" },
  pokracovat: { label: "Pokračovat", hint: "pokračování", action: "Pokračovat v zakázce" },
  reklamace_vyrizena: { label: "Reklamace vyřízena", hint: "vyřízení reklamace", action: "Uzavřít reklamaci" },
};

/** Výstup AI klasifikace pošty (structured output, `job_signal`). */
export interface AiJobSignal {
  kind: MailStageKind | "none";
  reason: string;
  confidence: number;
}

export interface StageSignal {
  kind: MailStageKind;
  /** Důvod do zakázky (předvyplněný, jde upravit). */
  reason: string;
  /** 0–1. */
  confidence: number;
  /** Věta z e-mailu, která signál nese (jen pro zobrazení v poště). */
  quote: string | null;
  lostReason: LostReason | null;
  claimReason: ClaimReason | null;
  source: "ai" | "rules" | "ai+rules";
}

/** Pod touto jistotou se nic nenavrhuje. */
export const MAIL_STAGE_MIN_CONFIDENCE = 0.5;
/** Od této jistoty smí plná automatika přepnout sama (jinak jen návrh). */
export const MAIL_STAGE_AUTO_CONFIDENCE = 0.8;

// ── Pravidla ────────────────────────────────────────────────
interface Rule {
  kind: MailStageKind;
  re: RegExp;
  /** Jistota samotného pravidla. */
  conf: number;
  lost?: LostReason;
  claim?: ClaimReason;
}

// Pozn.: text je složený (bez diakritiky, malá písmena) — vzory bez háčků a čárek.
const RULES: Rule[] = [
  // ─ reklamace (vada, rozměry, chybějící kusy, poškození)
  { kind: "reklamace", re: /\breklam(ujeme|uji|ujem|ovat|ace|aci|acni)\b/, conf: 0.85, claim: "jine" },
  { kind: "reklamace", re: /\b(nesedi|nesouhlasi|neodpovida(ji)?)\b.{0,30}\b(rozmer|rozmery|toleranc|vykres)/, conf: 0.8, claim: "rozmery" },
  { kind: "reklamace", re: /\b(rozmer|rozmery|prumer|delka|zavit)\w*\b.{0,30}\b(mimo|nesedi|neodpovida|spatn)/, conf: 0.75, claim: "rozmery" },
  { kind: "reklamace", re: /\bmimo tolerance?\w*/, conf: 0.75, claim: "rozmery" },
  { kind: "reklamace", re: /\b(chybi|chybely|chybeji|dorazilo jen|prislo jen|dodali jste jen)\b.{0,25}\b\d+\s*(ks|kus|kusu|kusy|dilu|dily)\b/, conf: 0.75, claim: "mnozstvi" },
  { kind: "reklamace", re: /\b(poskozen|pomacka|zlomen|prasl)\w*/, conf: 0.65, claim: "poskozeni" },
  { kind: "reklamace", re: /\b(vadn[ey]ch?|vada|vady|zmetk\w*|nevyhovuj\w*)\b.{0,40}\b(dil|dily|dilu|kus|kusy|kusu|vyrob|material|povrch)/, conf: 0.75, claim: "jine" },
  { kind: "reklamace", re: /\b(spatn[ey]|spatne)\s+(vyroben|obroben|dodan|zakalen|povrch)\w*/, conf: 0.7, claim: "jine" },
  { kind: "reklamace", re: /\b(reklamation|beanstand\w*|mangelhaft|fehlerhaft|ausschuss)\b/, conf: 0.8, claim: "jine" },
  { kind: "reklamace", re: /\b(ma(ss|ß)abweichung|ausserhalb der toleranz|nicht ma(ss|ß)haltig)/, conf: 0.8, claim: "rozmery" },
  { kind: "reklamace", re: /\b(es fehlen|fehlen)\s+\d+\s*(stk|stuck|teile)\b/, conf: 0.75, claim: "mnozstvi" },
  { kind: "reklamace", re: /\bbeschadigt\b/, conf: 0.65, claim: "poskozeni" },
  { kind: "reklamace", re: /\b(complaint|defective|non-?conform\w*|ncr|rejected parts|quality claim)\b/, conf: 0.8, claim: "jine" },
  { kind: "reklamace", re: /\b(out of tolerance|wrong dimension\w*|dimensions? (are|is) (wrong|out))/, conf: 0.8, claim: "rozmery" },
  { kind: "reklamace", re: /\b(missing|short (by|of))\s+\d+\s*(pcs|pieces|parts)\b|\b\d+\s*(pcs|pieces|parts) (are |were )?missing\b/, conf: 0.75, claim: "mnozstvi" },
  { kind: "reklamace", re: /\b(arrived )?damaged\b/, conf: 0.6, claim: "poskozeni" },

  // ─ nerealizováno (nabídka nevyšla — jiný dodavatel, cena, termín, projekt zrušen)
  { kind: "nerealizovano", re: /\b(vybrali|zvolili|objednali|zadali)\b.{0,30}\b(jineho|jinou|jinde|konkurenc)/, conf: 0.85, lost: "jiny_dodavatel" },
  { kind: "nerealizovano", re: /\bjineho dodavatele\b/, conf: 0.75, lost: "jiny_dodavatel" },
  { kind: "nerealizovano", re: /\bcena\b.{0,25}\b(je |byla )?(pro nas )?(prilis |moc |vyrazne )?(vysok|nad (nasim )?rozpoct)|\bjste (prilis |moc )?drazsi\b|\bnad nasim rozpoctem\b/, conf: 0.75, lost: "cena" },
  { kind: "nerealizovano", re: /\b(termin|dodaci lhut\w*)\b.{0,30}\b(nevyhovuj|prilis dlouh|nestihnete|pozde)/, conf: 0.65, lost: "termin" },
  { kind: "nerealizovano", re: /\bprojekt\b.{0,25}\b(zrusen|stopnut|zastaven|nebude realizovan|se nerealizuje)/, conf: 0.85, lost: "projekt_zrusen" },
  { kind: "nerealizovano", re: /\b(nabidk\w*)\b.{0,25}\b(neakceptuj|nevyuzij|nebudeme vyuzivat|odmita|neprijm)\w*/, conf: 0.8, lost: "jine" },
  { kind: "nerealizovano", re: /\b(od poptavky ustupujeme|poptavka (je )?(bezpredmetna|zrusena)|nebudeme (nic )?objednavat|zakazku (nakonec )?nerealizujeme)\b/, conf: 0.8, lost: "projekt_zrusen" },
  { kind: "nerealizovano", re: /\b(rusime|stahujeme|zruste|stornujeme)\b.{0,20}\bpoptavk/, conf: 0.8, lost: "zakaznik_stahl" },
  { kind: "nerealizovano", re: /\b(anderen|anderweitig\w*) (lieferanten|vergeben)|\banderweitig vergeben\b/, conf: 0.85, lost: "jiny_dodavatel" },
  { kind: "nerealizovano", re: /\b(zu teuer|preis (ist |liegt )?(zu hoch|uber unserem budget))\b/, conf: 0.75, lost: "cena" },
  { kind: "nerealizovano", re: /\bprojekt\b.{0,25}\b(storniert|abgesagt|gestoppt|eingestellt)\b|\bkein bedarf mehr\b/, conf: 0.8, lost: "projekt_zrusen" },
  { kind: "nerealizovano", re: /\b(another|different|other) (supplier|vendor|source)\b|\bwent with (another|a different)\b|\bplaced the order elsewhere\b/, conf: 0.85, lost: "jiny_dodavatel" },
  { kind: "nerealizovano", re: /\b(price is too high|too expensive|over (our )?budget)\b/, conf: 0.75, lost: "cena" },
  { kind: "nerealizovano", re: /\bproject\b.{0,25}\b(cancell?ed|stopped|will not (go ahead|proceed))\b|\bdecided not to proceed\b|\bno longer (needed|required)\b/, conf: 0.8, lost: "projekt_zrusen" },

  // ─ zrušeno (zákazník ruší potvrzenou objednávku)
  { kind: "zruseno", re: /\b(stornujeme|stornuji|stornujte|stornovat|stornovani|storno)\b.{0,30}\b(objednavk|zakazk|po\b)/, conf: 0.85, lost: "projekt_zrusen" },
  { kind: "zruseno", re: /\bobjednavk\w*\b.{0,30}\b(stornujeme|rusime|stahujeme|zrusit|zruste|zrusena|stornovana|stornujte)\b/, conf: 0.85, lost: "projekt_zrusen" },
  { kind: "zruseno", re: /\b(zruste|rusime|odstupujeme od)\b.{0,20}\b(objednavk|zakazk)/, conf: 0.85, lost: "projekt_zrusen" },
  { kind: "zruseno", re: /\b(bestellung|auftrag)\b.{0,30}\b(stornier\w*|annullier\w*|zuruckzieh\w*)|\bstornierung\b/, conf: 0.85, lost: "projekt_zrusen" },
  { kind: "zruseno", re: /\bcancel\w*\b.{0,25}\b(purchase order|order|po)\b|\border cancell?ation\b|\bwithdraw (our|the) order\b/, conf: 0.85, lost: "projekt_zrusen" },

  // ─ pozastaveno (zákazník chce počkat / posunout)
  { kind: "pozastaveno", re: /\b(pozastav|pozdrz|pozastaveni)\w*/, conf: 0.85 },
  { kind: "pozastaveno", re: /\b(zastavte|zastavit)\b.{0,20}\b(vyrob|prac|zakazk)/, conf: 0.85 },
  { kind: "pozastaveno", re: /\b(zatim (ne)?vyrabejte|zatim nevyrabet|pockejte s (vyrobou|vyrobenim)|nezacinejte s vyrobou|vyrobu (zatim )?odlozte)\b/, conf: 0.8 },
  { kind: "pozastaveno", re: /\b(posunte|posunout|odlozte|odlozit)\b.{0,25}\b(vyrob|zakazk|dodani|termin)/, conf: 0.55 },
  { kind: "pozastaveno", re: /\b(anhalten|pausieren|zuruckstellen|vorerst nicht (fertigen|produzieren)|auf eis legen)\b/, conf: 0.8 },
  { kind: "pozastaveno", re: /\bon hold\b|\b(pause|stop|halt) (the )?(production|order|manufacturing|work)\b|\bhold off\b/, conf: 0.8 },
  { kind: "pozastaveno", re: /\bpostpone\w*\b/, conf: 0.55 },

  // ─ pokračovat (zákazník uvolnil pozastavenou zakázku)
  { kind: "pokracovat", re: /\b(muzete|muzes)\s+(opet |znovu |uz |zase )?(pokracovat|vyrabet|zacit vyrabet|rozjet)\b/, conf: 0.85 },
  { kind: "pokracovat", re: /\b(pokracujte|rozjedte|uvolnujeme|uvolnili jsme)\b/, conf: 0.8 },
  { kind: "pokracovat", re: /\b(rusime|konec|zruseni) pozastaveni\b|\bpozastaveni (je |bylo )?(zruseno|ukonceno)\b/, conf: 0.9 },
  { kind: "pokracovat", re: /\b(fortfahren|weitermachen|fortsetzen|freigegeben|freigabe erteilt)\b/, conf: 0.75 },
  { kind: "pokracovat", re: /\b(you (can|may) (now )?(proceed|continue|resume)|please (proceed|resume|continue)|go ahead|resume (the )?(production|order|work)|released? (the )?(order|production))\b/, conf: 0.8 },

  // ─ reklamace vyřízena
  { kind: "reklamace_vyrizena", re: /\breklamac\w*\b.{0,25}\b(vyrizen|uzavren|vyresen|ukoncen)\w*/, conf: 0.85 },
  { kind: "reklamace_vyrizena", re: /\b(nahradni|opravene|nove)\s+(dily|kusy)\b.{0,30}\b(v poradku|sedi|dorazil)/, conf: 0.75 },
  { kind: "reklamace_vyrizena", re: /\breklamation\b.{0,25}\b(erledigt|abgeschlossen)\b/, conf: 0.85 },
  { kind: "reklamace_vyrizena", re: /\b(complaint|claim|ncr)\b.{0,20}\b(closed|resolved)\b|\breplacement parts\b.{0,25}\b(ok|fine|good|received)\b/, conf: 0.8 },
];

/** Věta popírá / jen se ptá — „nejde o reklamaci", „kein Storno", „not a complaint". */
const NEGATION_RE = /\b(nejde o|neni to|nejedna se o|nechceme|nebudeme|nemame v umyslu|neni treba|not a|no need to|don'?t|do not|kein|keine|nicht)\b/;
const QUESTION_RE = /\?\s*$/;
/** Pořadí při stejné jistotě — konkrétnější druh vyhrává. */
const KIND_PRIORITY: MailStageKind[] = ["reklamace_vyrizena", "pokracovat", "zruseno", "reklamace", "nerealizovano", "pozastaveno"];

/** Věty vlastního textu (bez citací / podpisu — čistí volající). */
function sentences(text: string): { folded: string; raw: string }[] {
  const raw = text.replace(/\r\n?/g, "\n").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  return raw.map((s) => ({ raw: s, folded: fold(s) }));
}

/** Důvod (věta zákazníka) — oříznutý na rozumnou délku. */
function clip(s: string, max = 280): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * Deterministická pravidla nad vlastním textem e-mailu (CZ / DE / EN): nejsilnější signál, nebo null.
 * Popření („nejde o reklamaci") signál věty ruší; otázka („Můžete pokračovat?") ho oslabí.
 */
export function detectStageSignalRules(text: string | null | undefined, subject?: string | null): StageSignal | null {
  const list = sentences([subject ?? "", text ?? ""].filter(Boolean).join("\n"));
  const hits: { rule: Rule; conf: number; raw: string }[] = [];
  list.forEach((s, idx) => {
    for (const rule of RULES) {
      const m = rule.re.exec(s.folded);
      if (!m) continue;
      // popření těsně před nálezem (≤ 30 znaků) — „nejde o reklamaci", „bitte nicht stornieren"
      if (NEGATION_RE.test(s.folded.slice(Math.max(0, m.index - 30), m.index))) continue;
      let conf = rule.conf;
      if (QUESTION_RE.test(s.raw)) conf *= 0.6;
      // předmět „Re: …" sám nestačí (jen slabší podpora)
      if (idx === 0 && subject && s.raw === subject.trim()) conf *= 0.8;
      hits.push({ rule, conf, raw: s.raw });
    }
  });
  if (!hits.length) return null;
  // nejjistější; při shodě konkrétnější druh („reklamace vyřízena" před „reklamace", storno před prohrou)
  hits.sort((a, b) => b.conf - a.conf || KIND_PRIORITY.indexOf(a.rule.kind) - KIND_PRIORITY.indexOf(b.rule.kind));
  const top = hits[0];
  const same = hits.filter((h) => h.rule.kind === top.rule.kind);
  // podrobnost (důvod prohry / druh reklamace): první konkrétní z nálezů stejného druhu
  const lost = same.find((h) => h.rule.lost && h.rule.lost !== "jine")?.rule.lost ?? top.rule.lost ?? null;
  const claim = same.find((h) => h.rule.claim && h.rule.claim !== "jine")?.rule.claim ?? top.rule.claim ?? null;
  return {
    kind: top.rule.kind, reason: clip(top.raw), confidence: Math.round(top.conf * 1000) / 1000, quote: clip(top.raw, 400),
    lostReason: lost, claimReason: claim, source: "rules",
  };
}

/** Normalizuje výstup AI (neznámý druh / mimo 0–1 → bezpečně). */
export function parseAiJobSignal(v: unknown): AiJobSignal | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const kind = o.kind === "none" ? "none" : isMailStageKind(o.kind) ? o.kind : null;
  if (!kind) return null;
  const c = Number(o.confidence);
  return {
    kind, reason: typeof o.reason === "string" ? o.reason.trim().slice(0, 500) : "",
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0,
  };
}

/** Důvod prohry / druh reklamace odhadnutý z textu důvodu (když ho dodala jen AI). */
function guessDetail(kind: MailStageKind, reason: string): { lostReason: LostReason | null; claimReason: ClaimReason | null } {
  const r = detectStageSignalRules(reason);
  if (r && r.kind === kind) return { lostReason: r.lostReason, claimReason: r.claimReason };
  if (kind === "reklamace") return { lostReason: null, claimReason: "jine" };
  if (kind === "nerealizovano" || kind === "zruseno") return { lostReason: kind === "zruseno" ? "projekt_zrusen" : "jine", claimReason: null };
  return { lostReason: null, claimReason: null };
}

/**
 * Spojí AI (`job_signal` z klasifikace pošty; null = AI neběžela) a pravidla:
 *  - shoda → jistota o kus vyšší (AI + pravidla),
 *  - jen AI → 90 % její jistoty (pravidla nic nenašla),
 *  - jen pravidla a AI neběžela → jistota pravidla; AI výslovně „none" → jen návrh (65 %),
 *  - rozpor → silnější z obou, ale jistota 60 % (vždy jen ke schválení).
 */
export function combineSignals(ai: AiJobSignal | null, rules: StageSignal | null): StageSignal | null {
  const aiKind = ai && ai.kind !== "none" ? ai.kind : null;
  if (aiKind && rules && rules.kind === aiKind) {
    return {
      ...rules, source: "ai+rules", reason: ai!.reason || rules.reason,
      confidence: Math.round(Math.min(0.98, Math.max(ai!.confidence, rules.confidence) + 0.1) * 1000) / 1000,
    };
  }
  if (aiKind && !rules) {
    const reason = ai!.reason || MAIL_STAGE_META[aiKind].label;
    return { kind: aiKind, reason: clip(reason), confidence: Math.round(ai!.confidence * 0.9 * 1000) / 1000, quote: null, source: "ai", ...guessDetail(aiKind, reason) };
  }
  if (!aiKind && rules) {
    if (!ai) return rules;
    return { ...rules, confidence: Math.round(rules.confidence * 0.65 * 1000) / 1000 };
  }
  if (aiKind && rules) {
    const useAi = ai!.confidence >= rules.confidence;
    const base: StageSignal = useAi
      ? { kind: aiKind, reason: clip(ai!.reason || MAIL_STAGE_META[aiKind].label), confidence: ai!.confidence, quote: null, source: "ai", ...guessDetail(aiKind, ai!.reason) }
      : rules;
    return { ...base, confidence: Math.round(Math.max(ai!.confidence, rules.confidence) * 0.6 * 1000) / 1000 };
  }
  return null;
}

// ── Sedí signál na stav zakázky? ────────────────────────────
export interface StageJobFacts {
  stage: JobStage;
  sideFromStage?: JobStage | null;
  itemsCount?: number | null;
  itemsDelivered?: number | null;
  claimOpenedAt?: string | null;
  claimResolvedAt?: string | null;
  claimFromStage?: JobStage | null;
  mergedIntoId?: string | null;
}

export type StageFit =
  | { ok: true; kind: MailStageKind; to: JobStage; lostReason?: LostReason | null; remapped?: boolean; closed?: boolean }
  | { ok: false; why: string };

function effectiveRank(f: StageJobFacts): number {
  const r = flowRank(f.stage);
  if (r >= 0) return r;
  if ((f.stage === "pozastaveno" || f.stage === "reklamace") && f.sideFromStage) return flowRank(f.sideFromStage);
  return -1;
}

/**
 * Sedí druh na aktuální stav? Nerealizováno jen před objednávkou (po objednávce → Zrušeno, důvod projekt
 * zrušen), zrušeno jen po objednávce před dodáním (před objednávkou → Nerealizováno), reklamace ve výrobě
 * a po dodání (fakturovaná / dokončená jen jako návrh — closed), pozastavit jen rozpracovanou před dodáním,
 * pokračovat jen z pozastavení, vyřízení jen otevřené reklamace. Uzavřená / sloučená zakázka nic.
 */
export function stageFit(kind: MailStageKind, f: StageJobFacts): StageFit {
  if (f.mergedIntoId) return { ok: false, why: "Zakázka je sloučená." };
  const s = f.stage;
  if (s === "nerealizovano" || s === "zruseno") return { ok: false, why: "Zakázka je uzavřená." };
  const rank = flowRank(s);
  const eff = effectiveRank(f);
  const claimOpen = Boolean(f.claimOpenedAt) && !f.claimResolvedAt;
  switch (kind) {
    case "reklamace": {
      if (s === "reklamace" || claimOpen) return { ok: false, why: "Reklamace už je otevřená." };
      if (rank >= 10) return { ok: true, kind, to: "reklamace", closed: true };
      if (rank >= 5 && rank <= 9) return { ok: true, kind, to: "reklamace" };
      const delivered = rank >= 3 && Number(f.itemsCount) > 0 && Number(f.itemsDelivered) >= Number(f.itemsCount);
      if (delivered) return { ok: true, kind, to: "reklamace" };
      return { ok: false, why: "Reklamovat jde zakázku ve výrobě nebo dodanou." };
    }
    case "nerealizovano":
      if (eff >= 0 && eff <= 2 && (rank >= 0 || s === "pozastaveno")) return { ok: true, kind, to: "nerealizovano" };
      if (eff >= 3 && eff <= 8 && (rank >= 0 || s === "pozastaveno")) return { ok: true, kind: "zruseno", to: "zruseno", lostReason: "projekt_zrusen", remapped: true };
      return { ok: false, why: "Zakázka je už dodaná." };
    case "zruseno":
      if (eff >= 3 && eff <= 8 && (rank >= 0 || s === "pozastaveno")) return { ok: true, kind, to: "zruseno" };
      if (eff >= 0 && eff <= 2 && (rank >= 0 || s === "pozastaveno")) return { ok: true, kind: "nerealizovano", to: "nerealizovano", lostReason: "projekt_zrusen", remapped: true };
      return { ok: false, why: "Zakázka je už dodaná." };
    case "pozastaveno":
      if (rank >= 0 && rank <= 8) return { ok: true, kind, to: "pozastaveno" };
      return { ok: false, why: s === "pozastaveno" ? "Zakázka už je pozastavená." : "Pozastavit jde jen rozpracovanou zakázku před dodáním." };
    case "pokracovat": {
      if (s !== "pozastaveno") return { ok: false, why: "Zakázka není pozastavená." };
      const t = f.sideFromStage ?? null;
      if (!t || flowRank(t) < 0) return { ok: false, why: "Nevím, kde zakázka stála." };
      return { ok: true, kind, to: t };
    }
    case "reklamace_vyrizena": {
      if (!claimOpen && s !== "reklamace") return { ok: false, why: "Zakázka nemá otevřenou reklamaci." };
      if (s === "reklamace") {
        const back = f.claimFromStage && flowRank(f.claimFromStage) >= 0 ? f.claimFromStage
          : f.sideFromStage && flowRank(f.sideFromStage) >= 0 ? f.sideFromStage : "dodano_zakaznikovi";
        return { ok: true, kind, to: back };
      }
      const prev = f.claimFromStage ?? null;
      return { ok: true, kind, to: prev && flowRank(prev) > rank ? prev : s };
    }
  }
}

// ── Rozhodnutí ──────────────────────────────────────────────
export type StageDecision = "auto" | "approval" | "ignore";

/**
 * Plná automatika přepne sama jen: režim „full", zákazník té zakázky, jistota ≥ 0,8, e-mail nejmenuje jinou
 * zakázku a zakázka není vyfakturovaná / dokončená. Jinak návrh (od jistoty 0,5); dodavatel nikdy.
 */
export function decideStageAction(p: {
  confidence: number; party: "customer" | "supplier" | "other"; mode: "full" | "approval"; hold?: boolean; closed?: boolean;
}): StageDecision {
  if (p.party === "supplier") return "ignore";
  if (!(p.confidence >= MAIL_STAGE_MIN_CONFIDENCE)) return "ignore";
  if (p.mode === "full" && p.party === "customer" && !p.hold && !p.closed && p.confidence >= MAIL_STAGE_AUTO_CONFIDENCE) return "auto";
  return "approval";
}

/** Druhy, na které jde v korekci přepnout pro daný stav (vždy i původní druh). */
export function correctableKinds(f: StageJobFacts, current?: MailStageKind | null): MailStageKind[] {
  const out = MAIL_STAGE_KINDS.filter((k) => {
    const fit = stageFit(k, f);
    return fit.ok && fit.kind === k;
  });
  if (current && !out.includes(current)) out.unshift(current);
  return out;
}

/** Titulek návrhu: „E-mail od Jan Novák naznačuje reklamaci zakázky Z-2026-014 — přepnout do Reklamace?" */
export function proposalTitle(kind: MailStageKind, from: string, jobNumber: string): string {
  const target = kind === "pokracovat" ? "pokračovat" : kind === "reklamace_vyrizena" ? "uzavřít reklamaci" : `přepnout do ${MAIL_STAGE_META[kind].label}`;
  return `E-mail od ${from} naznačuje ${MAIL_STAGE_META[kind].hint} zakázky ${jobNumber} — ${target}?`;
}
