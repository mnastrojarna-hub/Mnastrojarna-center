/**
 * Jazykově nezávislá fakta (kontakty, identifikace, stroje, vazby služeb, reference).
 * Texty jsou ve slovnících cs.ts / en.ts / de.ts.
 */
import type { Locale, ServiceId } from "@/i18n/config";
import { SERVICE_IDS } from "@/i18n/config";

export const SITE = {
  url: "https://www.mnastrojarna.cz",
  name: "Mnástrojárna s.r.o.",
  shortName: "Mnástrojárna",
  founded: 2012,
  isoSince: 2017,
  minOrderCzk: 50_000,
  phone: "+420 774 534 513",
  phoneHref: "tel:+420774534513",
  email: "info@nastrojarstvi.com",
  ico: "04304080",
  dic: "CZ04304080",
  dataBox: "u8h7mrg",
  workshop: { street: "Mezná 9", zip: "393 01", city: "Pelhřimov", lat: 49.34728, lng: 15.2106289 },
  billing: { street: "Varšavská 715/36", zip: "120 00", city: "Praha 2 – Vinohrady" },
} as const;

export type TeamId = "semorad" | "volny" | "sponer";
export type Person = { id: TeamId; name: string; phone?: string; phoneHref?: string; email: string; initials: string; photo?: string };

/** Pořadí: jednatel, obchod, technolog. Fotky doplnit do public/team/ a pole `photo`. */
export const TEAM: Person[] = [
  { id: "semorad", name: "Jiří Semorád", phone: "+420 774 534 513", phoneHref: "tel:+420774534513", email: "semorad@nastrojarstvi.com", initials: "JS" },
  { id: "volny", name: "Vít Volný", phone: "+420 734 846 246", phoneHref: "tel:+420734846246", email: "vit.volny@mnastrojarna.cz", initials: "VV" },
  { id: "sponer", name: "Dominik Šponer", phone: "+420 607 688 841", phoneHref: "tel:+420607688841", email: "dominik.sponer@mnastrojarna.cz", initials: "DŠ" },
];
export const SALES = TEAM[1];
export const TECH = TEAM[2];

export type IconName = "mill" | "axes" | "wire" | "die" | "machine" | "prototype" | "spare" | "cad" | "measure" | "stock";

export const SERVICE_FACTS: Record<ServiceId, { icon: IconName; machines?: string[] }> = {
  "cnc-obrabeni": { icon: "mill", machines: ["axile-g8", "hypertun-65", "mcv-754q", "vmca-760", "sab-50"] },
  "petiose-cnc-obrabeni": { icon: "axes", machines: ["axile-g8", "hypertun-65"] },
  "elektroerozivni-obrabeni": { icon: "wire", machines: ["fanuc-robocut"] },
  "nahradni-dily-pro-vyrobni-linky": { icon: "spare", machines: ["hypertun-65", "axile-g8", "sab-50"] },
  nastrojarstvi: { icon: "die", machines: ["fanuc-robocut", "axile-g8", "mcv-754q"] },
  "jednoucelove-stroje": { icon: "machine" },
  "vyroba-prototypu": { icon: "prototype", machines: ["axile-g8", "hypertun-65", "fanuc-robocut"] },
  "programovani-a-konstrukce": { icon: "cad" },
  "mereni-a-kontrola-kvality": { icon: "measure" },
  "konsignacni-skladovani": { icon: "stock" },
};
export const SERVICE_ORDER: readonly ServiceId[] = SERVICE_IDS;

export const MACHINES: { id: string; name: string; image?: string }[] = [
  { id: "axile-g8", name: "AXILE G8", image: "/img/axile-g8.png" },
  { id: "hypertun-65", name: "HYPERTUN 65 Powermill", image: "/img/hypertun-65.jpg" },
  { id: "fanuc-robocut", name: "FANUC ROBOCUT α-C800iB", image: "/img/fanuc-robocut.jpg" },
  { id: "mcv-754q", name: "MCV 754Q", image: "/img/mcv-754q.jpg" },
  { id: "vmca-760", name: "VMCA 760", image: "/img/vmca-760.jpg" },
  { id: "sab-50", name: "SAB 50 CNC" },
  { id: "konvencni", name: "SV18RA · FA3V · BPH20" },
];

/**
 * REFERENCE — převzaté ze stávajícího webu mnastrojarna.cz (loga v public/references/).
 * kind "client" = zákazník, "partner" = spolupráce se školami / výzkumem.
 * Případovou studii doplňte do `text` (jen se souhlasem klienta) — zobrazí se na stránce Reference.
 */
export type Reference = {
  id: string;
  client: string;
  kind: "client" | "partner";
  logo?: string;
  country?: string;
  services?: ServiceId[];
  text?: Partial<Record<Locale, { title: string; summary: string; result?: string }>>;
};

const ref = (id: string, client: string, kind: Reference["kind"] = "client"): Reference => ({ id, client, kind, logo: `/references/${id}.jpg` });

export const REFERENCES: Reference[] = [
  ref("bosch-powertrain", "Bosch Powertrain s.r.o."),
  ref("rimowa", "RIMOWA GmbH"),
  ref("valeo-compressors", "Valeo Compressors"),
  ref("edscha", "Edscha"),
  ref("kompaflex", "kompaflex ag"),
  ref("wohler-bohemia", "Wöhler Bohemia s.r.o."),
  ref("brisk", "BRISK"),
  ref("hofmeister", "HOFMEISTER s.r.o."),
  ref("triapex", "Triapex s.r.o."),
  ref("mp-dims", "MP DIMS a.s."),
  ref("belis", "BELIS a.s."),
  ref("modia", "Modia a.s."),
  ref("fia-proteam", "FIA ProTeam s.r.o."),
  ref("auttec", "AUTTEC s.r.o."),
  ref("vsp-kovo", "VSP Kovo"),
  ref("hranipex", "Hranipex"),
  ref("vut-brno", "Vysoké učení technické v Brně", "partner"),
  ref("sps-pelhrimov", "SPŠ a SOU Pelhřimov", "partner"),
];

/** Fotografie skutečných zakázek — výběr z archivu zakázek (src/content/cases.ts). */
export const GALLERY: { src: string; w: number; h: number }[] = [
  ["rotory-s-drazkami/1", 1200, 900],
  ["paletove-upinaci-pripravky/1", 1200, 900],
  ["paprskove-kolo-a-pouzdro/1", 1200, 900],
  ["hrebenova-deska-a-pouzdro/2", 1200, 675],
  ["presne-male-dily/1", 1200, 675],
  ["desky-skorepiny-a-mereni/1", 1200, 900],
  ["presne-male-dily/2", 1200, 675],
  ["dily-podle-vykresu/1", 1200, 720],
  ["paprskove-kolo-a-pouzdro/2", 1200, 900],
  ["paletove-upinaci-pripravky/4", 1200, 900],
  ["tvarove-slozita-skrin/1", 1200, 900],
  ["pripravky-s-pneumatikou/2", 1200, 900],
  ["desky-skorepiny-a-mereni/2", 1200, 900],
  ["upinaci-pripravek-2015/1", 1200, 720],
  ["paletove-upinaci-pripravky/6", 1200, 900],
  ["dily-podle-vykresu/2", 1200, 720],
].map(([p, w, h]) => ({ src: `/img/zakazky/${p}.jpg`, w: w as number, h: h as number }));
