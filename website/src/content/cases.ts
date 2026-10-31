/**
 * ARCHIV ZAKÁZEK — skutečné fotografie z dílny (převzaté ze stávající galerie webu).
 * Popisy vycházejí výhradně z toho, co je na fotografiích vidět. Rok = datum pořízení fotografie (pokud je známo).
 *
 * DOPLNIT OD FIRMY (u každé zakázky, nepovinné): `brief` (zadání / problém zákazníka),
 * `solution` (jak jsme to vyřešili), `result` (výsledek), obor / klient (se souhlasem), technologie.
 * Co je vyplněno, web automaticky zobrazí; prázdná pole se neukazují.
 */
import type { Locale, ServiceId } from "@/i18n/config";

type Text = { title: string; summary: string; brief?: string; solution?: string; result?: string };

export type CaseStudy = {
  slug: Record<Locale, string>;
  year?: number;
  kind: "fixture" | "part" | "assembly";
  services: ServiceId[];
  photos: { src: string; w: number; h: number }[];
  text: Record<Locale, Text>;
};

const ph = (dir: string, sizes: [number, number][]) => sizes.map(([w, h], i) => ({ src: `/img/zakazky/${dir}/${i + 1}.jpg`, w, h }));
const Q: [number, number] = [1200, 900];
const W: [number, number] = [1200, 675];
const V: [number, number] = [1200, 720];
const S: [number, number] = [1000, 564];

export const CASES: CaseStudy[] = [
  {
    slug: { cs: "paletove-upinaci-pripravky", en: "palletised-clamping-fixtures", de: "palettierte-spannvorrichtungen" },
    kind: "fixture",
    services: ["nastrojarstvi", "cnc-obrabeni"],
    photos: ph("paletove-upinaci-pripravky", [Q, Q, Q, Q, Q, Q, Q]),
    text: {
      cs: {
        title: "Paletové upínací přípravky",
        summary:
          "Sada upínacích palet s několika pozicemi, rychloupínači a madly pro manipulaci. Každá pozice drží díl vždy ve stejné poloze, takže obsluha jen vymění paletu a stroj pokračuje.",
      },
      en: {
        title: "Palletised clamping fixtures",
        summary:
          "A set of multi-station clamping pallets with toggle clamps and handles. Every station locates the part in exactly the same position – the operator simply swaps the pallet and the machine keeps running.",
      },
      de: {
        title: "Palettierte Spannvorrichtungen",
        summary:
          "Ein Satz Mehrfach-Spannpaletten mit Schnellspannern und Griffen. Jede Station fixiert das Teil immer in derselben Lage – der Bediener tauscht nur die Palette, die Maschine läuft weiter.",
      },
    },
  },
  {
    slug: { cs: "pripravky-s-pneumatikou", en: "pneumatic-fixtures", de: "pneumatische-vorrichtungen" },
    kind: "assembly",
    services: ["nastrojarstvi", "jednoucelove-stroje"],
    photos: ph("pripravky-s-pneumatikou", [Q, Q, Q, Q, Q, Q]),
    text: {
      cs: {
        title: "Přípravky s pneumatickým pohonem",
        summary:
          "Přípravky a jednoduchá jednoúčelová zařízení s pneumatickými válci, vedením a nastavitelnými dorazy – od upínacího bloku po pracoviště s otočným ramenem na nosném rámu.",
      },
      en: {
        title: "Pneumatically actuated fixtures",
        summary:
          "Fixtures and compact special-purpose devices with pneumatic cylinders, guides and adjustable stops – from a clamping block to a workstation with a swivel arm on a support frame.",
      },
      de: {
        title: "Vorrichtungen mit Pneumatikantrieb",
        summary:
          "Vorrichtungen und kompakte Sondervorrichtungen mit Pneumatikzylindern, Führungen und einstellbaren Anschlägen – vom Spannblock bis zum Arbeitsplatz mit Schwenkarm auf einem Tragrahmen.",
      },
    },
  },
  {
    slug: { cs: "rotory-s-drazkami", en: "slotted-rotors", de: "rotoren-mit-nuten" },
    year: 2016,
    kind: "part",
    services: ["cnc-obrabeni", "petiose-cnc-obrabeni"],
    photos: ph("rotory-s-drazkami", [Q]),
    text: {
      cs: { title: "Rotory s drážkami po obvodu", summary: "Rotační hliníkové díly s pravidelně dělenými drážkami po obvodu a přesným nábojem. Série tří kusů." },
      en: { title: "Rotors with peripheral slots", summary: "Turned aluminium parts with evenly indexed peripheral slots and a precise hub. A series of three pieces." },
      de: { title: "Rotoren mit Umfangsnuten", summary: "Gedrehte Aluminiumteile mit gleichmäßig geteilten Umfangsnuten und präziser Nabe. Serie von drei Stück." },
    },
  },
  {
    slug: { cs: "paprskove-kolo-a-pouzdro", en: "spoked-wheel-and-housing", de: "speichenrad-und-gehaeuse" },
    year: 2017,
    kind: "part",
    services: ["petiose-cnc-obrabeni", "cnc-obrabeni"],
    photos: ph("paprskove-kolo-a-pouzdro", [Q, Q]),
    text: {
      cs: {
        title: "Paprskové kolo a prstencové pouzdro",
        summary: "Kolo s paprsky a jemně děleným věncem obrobené z jednoho kusu a tenkostěnné prstencové pouzdro s upínkami a nastavitelnými prvky.",
      },
      en: {
        title: "Spoked wheel and ring housing",
        summary: "A spoked wheel with a finely divided rim machined from solid, and a thin-walled ring housing with clamps and adjustable elements.",
      },
      de: {
        title: "Speichenrad und Ringgehäuse",
        summary: "Ein aus dem Vollen gefrästes Speichenrad mit fein geteiltem Kranz sowie ein dünnwandiges Ringgehäuse mit Spannelementen und einstellbaren Teilen.",
      },
    },
  },
  {
    slug: { cs: "dily-podle-vykresu", en: "parts-to-drawing", de: "teile-nach-zeichnung" },
    year: 2016,
    kind: "part",
    services: ["cnc-obrabeni"],
    photos: ph("dily-podle-vykresu", [V, V, V, V]),
    text: {
      cs: {
        title: "Frézované díly podle výkresu",
        summary: "Tvarové díly z hliníku, oceli a bronzu vyrobené podle výkresové dokumentace zákazníka – kapsy, osazení a otvory z několika stran.",
      },
      en: {
        title: "Milled parts to drawing",
        summary: "Shaped parts in aluminium, steel and bronze made to the customer's drawings – pockets, shoulders and holes from several sides.",
      },
      de: {
        title: "Frästeile nach Zeichnung",
        summary: "Formteile aus Aluminium, Stahl und Bronze nach Kundenzeichnung – Taschen, Absätze und Bohrungen von mehreren Seiten.",
      },
    },
  },
  {
    slug: { cs: "presne-male-dily", en: "small-precision-parts", de: "kleine-praezisionsteile" },
    year: 2017,
    kind: "part",
    services: ["cnc-obrabeni"],
    photos: ph("presne-male-dily", [W, W, W, S, S, W, S, S]),
    text: {
      cs: {
        title: "Přesné drobné díly",
        summary: "Příruby, čepy, páky, bronzová pouzdra, lišty i díly z technických plastů – soustružené a frézované kusy pro sestavy strojů.",
      },
      en: {
        title: "Small precision parts",
        summary: "Flanges, pins, levers, bronze bushings, rails and engineering-plastic parts – turned and milled components for machine assemblies.",
      },
      de: {
        title: "Kleine Präzisionsteile",
        summary: "Flansche, Bolzen, Hebel, Bronzebuchsen, Leisten und Teile aus technischen Kunststoffen – gedrehte und gefräste Komponenten für Maschinenbaugruppen.",
      },
    },
  },
  {
    slug: { cs: "hrebenova-deska-a-pouzdro", en: "slotted-plate-and-sleeve", de: "kammplatte-und-huelse" },
    year: 2017,
    kind: "part",
    services: ["cnc-obrabeni", "elektroerozivni-obrabeni"],
    photos: ph("hrebenova-deska-a-pouzdro", [W, W]),
    text: {
      cs: { title: "Hřebenová deska a válcové pouzdro", summary: "Deska s řadou úzkých paralelních drážek a válcové pouzdro s otvory po obvodu." },
      en: { title: "Comb plate and cylindrical sleeve", summary: "A plate with a row of narrow parallel slots and a cylindrical sleeve with holes around its circumference." },
      de: { title: "Kammplatte und zylindrische Hülse", summary: "Eine Platte mit einer Reihe schmaler paralleler Nuten und eine zylindrische Hülse mit Bohrungen am Umfang." },
    },
  },
  {
    slug: { cs: "desky-skorepiny-a-mereni", en: "plates-shells-and-in-machine-probing", de: "platten-schalen-und-messung" },
    kind: "part",
    services: ["cnc-obrabeni", "mereni-a-kontrola-kvality"],
    photos: ph("desky-skorepiny-a-mereni", [Q, Q, Q, Q, Q, Q, Q]),
    text: {
      cs: {
        title: "Velké desky, skořepiny a měření ve stroji",
        summary: "Montážní desky s otvory a výřezy, tenkostěnné válcové skořepiny a konzoly. Rozměry kontrolujeme sondou přímo ve stroji, ještě než díl odepneme.",
      },
      en: {
        title: "Large plates, shells and in-machine probing",
        summary: "Mounting plates with holes and cut-outs, thin-walled cylindrical shells and brackets. Dimensions are probed in the machine before the part is unclamped.",
      },
      de: {
        title: "Große Platten, Schalen und Messung in der Maschine",
        summary: "Montageplatten mit Bohrungen und Ausschnitten, dünnwandige Zylinderschalen und Konsolen. Maße werden mit dem Taster in der Maschine geprüft, bevor das Teil ausgespannt wird.",
      },
    },
  },
  {
    slug: { cs: "tvarove-slozita-skrin", en: "complex-housing", de: "komplexes-gehaeuse" },
    kind: "part",
    services: ["vyroba-prototypu", "petiose-cnc-obrabeni"],
    photos: ph("tvarove-slozita-skrin", [Q, Q]),
    text: {
      cs: { title: "Tvarově složitá skříň", summary: "Skříň s množstvím výstupků, přírub a otvorů v různých rovinách – typický díl, který se bez víceosého obrábění neobejde." },
      en: { title: "Complex housing", summary: "A housing with numerous bosses, flanges and holes in different planes – a typical part that cannot be made without multi-axis machining." },
      de: { title: "Komplexes Gehäuse", summary: "Ein Gehäuse mit zahlreichen Augen, Flanschen und Bohrungen in verschiedenen Ebenen – ein typisches Teil, das ohne Mehrachsbearbeitung nicht auskommt." },
    },
  },
  {
    slug: { cs: "upinaci-pripravek-2015", en: "clamping-fixture-2015", de: "spannvorrichtung-2015" },
    year: 2015,
    kind: "fixture",
    services: ["nastrojarstvi"],
    photos: ph("upinaci-pripravek-2015", [V]),
    text: {
      cs: { title: "Upínací přípravek s výměnnými čelistmi", summary: "Upínací přípravek z kalené oceli s výměnnými čelistmi a bočními dorazy." },
      en: { title: "Clamping fixture with interchangeable jaws", summary: "A clamping fixture made of hardened steel with interchangeable jaws and side stops." },
      de: { title: "Spannvorrichtung mit Wechselbacken", summary: "Eine Spannvorrichtung aus gehärtetem Stahl mit Wechselbacken und seitlichen Anschlägen." },
    },
  },
];

export const caseBySlug = (locale: Locale, slug: string) => CASES.find((c) => c.slug[locale] === slug);
export const ALL_PHOTOS = CASES.flatMap((c) => c.photos.map((p) => ({ ...p, case: c })));
