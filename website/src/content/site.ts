/**
 * Veškerý obsah webu na jednom místě. Fakta převzata ze stávajícího webu mnastrojarna.cz
 * (stav 10/2026) + nové kontakty (V. Volný, D. Šponer). Upravujte zde — stránky se generují z těchto dat.
 */

export const SITE = {
  url: "https://www.mnastrojarna.cz",
  name: "Mnástrojárna s.r.o.",
  shortName: "Mnástrojárna",
  slogan: "Váš partner ve strojírenství",
  legacySlogan: "místo pro Vaši kooperaci…",
  description:
    "Přesné CNC obrábění, pětiosé frézování, drátové řezání, nástroje, jednoúčelové stroje a náhradní díly pro výrobní linky. B2B partner pro výrobní firmy. ISO 9001 a 14001, Pelhřimov.",
  founded: 2012,
  isoSince: 2017,
  minOrderCzk: 50_000,
  phone: "+420 774 534 513",
  phoneHref: "tel:+420774534513",
  email: "info@nastrojarstvi.com",
  hours: "Po–Pá 7:00–20:00",
  ico: "04304080",
  dic: "CZ04304080",
  dataBox: "u8h7mrg",
  registry: "Společnost zapsána 10. srpna 2015 u Městského soudu v Praze, oddíl C, vložka 245636.",
  workshop: {
    label: "Provozovna a korespondenční adresa",
    street: "Mezná 9",
    zip: "393 01",
    city: "Pelhřimov",
    region: "Kraj Vysočina",
    lat: 49.34728,
    lng: 15.2106289,
  },
  billing: {
    label: "Fakturační adresa",
    street: "Varšavská 715/36",
    zip: "120 00",
    city: "Praha 2 – Vinohrady",
  },
} as const;

export type Person = {
  name: string;
  role: string;
  focus: string;
  phone?: string;
  phoneHref?: string;
  email: string;
  initials: string;
  photo?: string;
};

export const TEAM: Person[] = [
  {
    name: "Jiří Semorád",
    role: "Jednatel",
    focus: "Cenové nabídky, rámcové smlouvy a strategické zakázky.",
    phone: "+420 774 534 513",
    phoneHref: "tel:+420774534513",
    email: "semorad@nastrojarstvi.com",
    initials: "JS",
  },
  {
    name: "Vít Volný",
    role: "Obchodní zástupce",
    focus: "Váš první kontakt pro nové projekty, poptávky a dlouhodobou spolupráci.",
    phone: "+420 734 846 246",
    phoneHref: "tel:+420734846246",
    email: "vit.volny@mnastrojarna.cz",
    initials: "VV",
  },
  {
    name: "Dominik Šponer",
    role: "Technolog",
    focus: "Technická analýza výkresů, volba technologie a vyrobitelnost dílů.",
    phone: "+420 607 688 841",
    phoneHref: "tel:+420607688841",
    email: "dominik.sponer@mnastrojarna.cz",
    initials: "DŠ",
  },
];

export type Service = {
  slug: string;
  title: string;
  short: string;
  /** SEO titulek (bez názvu firmy). */
  seoTitle: string;
  seoDescription: string;
  icon: IconName;
  lead: string;
  body: string[];
  bullets: string[];
  keywords: string[];
  machines?: string[];
  faq?: { q: string; a: string }[];
  /** Původní URL ze starého webu → 301 přesměrování. */
  legacy?: string[];
};

export type IconName =
  | "mill"
  | "axes"
  | "wire"
  | "die"
  | "machine"
  | "prototype"
  | "spare"
  | "cad"
  | "measure"
  | "stock";

export const SERVICES: Service[] = [
  {
    slug: "cnc-obrabeni",
    title: "CNC obrábění",
    short: "Frézování a soustružení kusových i sériových dílů včetně povrchových a tepelných úprav.",
    seoTitle: "CNC obrábění na zakázku – frézování a soustružení",
    seoDescription:
      "Zakázkové CNC frézování a soustružení kusových i sériových dílů do Ø 1 000 mm. Komplexní dodávky včetně povrchových a tepelných úprav, ISO 9001. Mnástrojárna Pelhřimov.",
    icon: "mill",
    lead: "Komplexní dodávky obráběných dílů – od jednoho prototypu po opakované série, včetně povrchových a tepelných úprav. Díl dostanete hotový a změřený.",
    body: [
      "Zajišťujeme širokou škálu výroby v oblasti CNC obrábění i komplexních dodávek dílů. Klademe vysoký důraz na přesnost a kvalitu – každý díl odchází s měřicím protokolem.",
      "CNC soustružení: vyrábíme vše od jednodušších soustružnických dílů až po nejnáročnější hřídele, ozubená kola i soustružené a současně pětiose frézované díly – díky kombinaci dvouvřetenového soustruhu a pětiosého obráběcího centra v jednom stroji.",
      "CNC frézování: disponujeme několika obráběcími centry včetně dvou pětiosých, která programujeme v CAD/CAM systémech ZW3D, Esprit a NCG CAM. Vyrábíme tvarově složité i rozměrově přesné díly až do průměru 900–1 000 mm.",
    ],
    bullets: [
      "Frézování 3 a 5 osé, soustružení s poháněnými nástroji",
      "Obrobky do Ø 1 000 mm a zatížení stolu až 3 000 kg",
      "Točná délka až 1 150 mm, průchod vřetena 64 mm",
      "Povrchové a tepelné úpravy v rámci jedné dodávky",
      "Kusová, malosériová i opakovaná výroba",
      "Zpracováváme všechny druhy dostupných materiálů",
    ],
    keywords: ["CNC obrábění", "CNC frézování", "CNC soustružení", "obrábění na zakázku", "kovoobrábění"],
    machines: ["axile-g8", "hypertun-65", "mcv-754q", "vmca-760", "sab-50"],
    legacy: ["/cz/technologie/cnc-obrabeni"],
    faq: [
      {
        q: "Jaké materiály obrábíte?",
        a: "Zpracováváme všechny běžně dostupné materiály – konstrukční a nástrojové oceli, nerez, hliník, barevné kovy, plasty i kompozity. U speciálních materiálů vám technolog potvrdí vyrobitelnost předem.",
      },
      {
        q: "Zajistíte i kalení a povrchové úpravy?",
        a: "Ano. Dodáváme kompletní díly včetně tepelného zpracování a povrchových úprav, takže řešíte jednoho dodavatele a jednu odpovědnost.",
      },
    ],
  },
  {
    slug: "petiose-cnc-obrabeni",
    title: "Pětiosé CNC obrábění",
    short: "Kontinuální 5osé obrábění tvarově složitých dílů až do Ø 1 000 mm na jedno upnutí.",
    seoTitle: "Pětiosé CNC obrábění – 5osé frézování složitých dílů",
    seoDescription:
      "Kontinuální pětiosé CNC obrábění velkých a tvarově složitých dílů do Ø 1 000 mm a 3 000 kg. AXILE G8 s Heidenhain iTNC640 a HYPERTUN 65. Mnástrojárna.",
    icon: "axes",
    lead: "Velká a vysoce přesná pětiosá obráběcí a měřicí centra. Tvarově složité díly obrobíme v pěti i více osách současně – na jedno upnutí, s vyšší přesností a kratším časem.",
    body: [
      "Pětiosé obráběcí centrum AXILE G8 patří mezi velká frézovací centra určená pro kontinuální pětiosé obrábění obrobků až do průměru 1 000 mm. Vysokou tuhost zajišťuje oboustranné uložení kolébky v litinovém rámu a dva motory v ose Y.",
      "Centrum řídí HEIDENHAIN iTNC640 s pravítky zpětného odměřování, je vybaveno automatickými sondami pro měření obrobků a laserovým měřením nástrojů. Programujeme v CAD/CAM NCG a ESPRIT.",
      "HYPERTUN 65 Powermill je dvouvřetenový, dvoukanálový soustruh kombinovaný s pětiosým frézovacím vřetenem. Sloučením operací do jednoho cyklu odpadají zdlouhavá a nákladná přeupínání.",
    ],
    bullets: [
      "Max. průměr obrobku 1 000 mm, zatížení stolu 3 000 kg",
      "Osy A/C ±120° / 380°, 120 nástrojů v zásobníku",
      "Otáčky vřetena 15 000 min⁻¹, HSK 63A",
      "Automatické měření obrobku i nástroje přímo ve stroji",
      "Soustružení + 5osé frézování v jednom stroji (HYPERTUN 65)",
    ],
    keywords: ["pětiosé obrábění", "5osé frézování", "simultánní obrábění", "obrábění složitých tvarů"],
    machines: ["axile-g8", "hypertun-65"],
    legacy: ["/cz/technologie/petiose-cnc-obrabeni"],
  },
  {
    slug: "elektroerozivni-obrabeni",
    title: "Drátové řezání (EDM)",
    short: "Elektroerozivní řezání drátem od Ø 0,1 mm až v pěti osách, obrobky do výšky 500 mm.",
    seoTitle: "Elektroerozivní obrábění – drátové řezání velkých dílů",
    seoDescription:
      "Drátové řezání EDM na FANUC ROBOCUT α-C800iB: obrobky až 1 250 × 975 × 500 mm, drát od Ø 0,1 mm, řezání v pěti osách. Mnástrojárna Pelhřimov.",
    icon: "wire",
    lead: "Velký elektroerozivní drátořez pro přesné průchozí tvary, střižníky, matrice a profily – i tam, kam fréza nedosáhne.",
    body: [
      "Disponujeme strojem pro drátové řezání FANUC ROBOCUT α-C800iB s pojezdem v ose Z 510 mm. Maximální rozměry obrobku jsou 1 250 × 975 × 500 mm, přejezdy 800 × 600 × 510 mm.",
      "Řežeme drátem od průměru 0,1 mm, a to až v pěti osách. Programujeme v softwaru Cami, díky kterému dosahujeme i složitých tvarů řezaných v pěti osách současně.",
    ],
    bullets: [
      "Obrobky až 1 250 × 975 × 500 mm",
      "Přejezdy X/Y/Z 800 × 600 × 510 mm",
      "Drát od Ø 0,1 mm",
      "Kuželové a tvarové řezy v 5 osách",
      "Ideální pro střižné nástroje, matrice a tvrdé materiály",
    ],
    keywords: ["drátové řezání", "elektroeroze", "EDM", "drátořez", "elektroerozivní obrábění"],
    machines: ["fanuc-robocut"],
    legacy: ["/cz/technologie/elektroerozivni-obrabeni"],
  },
  {
    slug: "nahradni-dily-pro-vyrobni-linky",
    title: "Náhradní díly pro výrobní linky",
    short: "Hřídele, válce, válečky, ozubená kola a opotřebitelné díly – rychle, i bez původní dokumentace.",
    seoTitle: "Výroba náhradních dílů pro výrobní linky a stroje",
    seoDescription:
      "Výroba náhradních dílů pro výrobní linky: hřídele, válce, válečky, ozubená kola, nože a přípravky. Urgentní výroba, konsignační sklad, ISO 9001. Mnástrojárna.",
    icon: "spare",
    lead: "Prostoj linky stojí víc než jakýkoli díl. Vyrobíme náhradní díly pro vaše stroje rychle a v kvalitě, za kterou ručíme – a ty kritické vám můžeme držet skladem.",
    body: [
      "Specializujeme se na výrobu jednotlivých náhradních dílů i jednoúčelových strojů, u kterých zajišťujeme kompletní povrchové a tepelné úpravy. Konstrukci, výrobu i montáž si realizujeme sami, proto za kvalitu i termín můžeme vždy ručit.",
      "Nemáte k dílu aktuální výkres? Naši konstruktéři s vámi navrhnou optimální řešení a dokumentaci připraví. Stálým odběratelům nabízíme urgentní výrobu, konsignační skladování a logistickou podporu.",
    ],
    bullets: [
      "Hřídele, válce, válečky, kladky, ozubená kola",
      "Formátovací a řezné díly, přípravky, opotřebitelné komponenty",
      "Urgentní výroba pro stálé odběratele",
      "Konsignační sklad kritických dílů",
      "Dokumentace a měřicí protokol ke každému dílu",
    ],
    keywords: ["náhradní díly", "výroba náhradních dílů", "díly pro výrobní linky", "výroba válečků", "výroba hřídelí"],
    machines: ["hypertun-65", "axile-g8", "sab-50"],
  },
  {
    slug: "nastrojarstvi",
    title: "Nástrojářství",
    short: "Lisovací, střižné a montážní nástroje, přípravky a měrky podle nejvyšších průmyslových standardů.",
    seoTitle: "Nástrojářství – lisovací, střižné a montážní nástroje",
    seoDescription:
      "Nástrojářská výroba lisovacích, střižných a montážních nástrojů, přípravků a prototypů. Konstrukce, CNC obrábění, drátové řezání a měření pod jednou střechou.",
    icon: "die",
    lead: "Jsme nástrojárna – přesnost je u nás výchozí nastavení. Navrhneme, vyrobíme a odladíme nástroje a přípravky, které ve vaší výrobě vydrží.",
    body: [
      "Vyrábíme lisovací, střižné a montážní nástroje, které splňují nejvyšší průmyslové standardy. Díky vlastní konstrukci, CNC obrábění, drátovému řezání a měření máme celý proces pod kontrolou.",
      "Kreslíme a konstruujeme přípravky, nástroje, stroje i prototypy v CAD/CAM systému ZW3D, se kterým pracujeme od roku 2013.",
    ],
    bullets: [
      "Lisovací a střižné nástroje",
      "Montážní a kontrolní přípravky",
      "Opravy a renovace nástrojů",
      "Vlastní konstrukce a dokumentace",
    ],
    keywords: ["nástrojárna", "nástrojářství", "lisovací nástroje", "střižné nástroje", "přípravky"],
    machines: ["fanuc-robocut", "axile-g8", "mcv-754q"],
  },
  {
    slug: "jednoucelove-stroje",
    title: "Jednoúčelové stroje",
    short: "Konstrukce a výroba speciálních strojů a výrobních linek včetně mechaniky, elektro a automatizace.",
    seoTitle: "Konstrukce a výroba jednoúčelových strojů a linek",
    seoDescription:
      "Návrh, konstrukce a výroba jednoúčelových strojů, přípravků a výrobních linek včetně mechaniky, elektroinstalace a automatizace. Od návrhu po montáž a servis.",
    icon: "machine",
    lead: "Stroj přesně pro váš proces. Od zadání přes konstrukci, výrobu dílů a montáž až po servis – jeden partner, jedna odpovědnost.",
    body: [
      "Navrhujeme a vyrábíme speciální stroje a výrobní linky včetně mechaniky, elektroinstalace a automatizace. Díky konstrukčnímu zázemí dokážeme vaše návrhy realizovat rychle a spolehlivě.",
      "Realizujeme projekty v oblastech výroby, automatizace, konstrukce strojů, robotiky a vývoje pokročilých technologií – v úzké spolupráci s univerzitami a výzkumnými institucemi.",
    ],
    bullets: [
      "Analýza procesu a návrh koncepce",
      "Strojní konstrukce a výrobní dokumentace",
      "Výroba dílů a montáž sestav ve vlastní režii",
      "Elektroinstalace a automatizace",
      "Uvedení do provozu a servis",
    ],
    keywords: ["jednoúčelové stroje", "výroba strojů na zakázku", "automatizace výroby", "konstrukce strojů"],
  },
  {
    slug: "vyroba-prototypu",
    title: "Vývoj a výroba prototypů",
    short: "Od návrhu přes konstrukci po funkční prototyp. Ověření konstrukce i obrobitelnosti.",
    seoTitle: "Výroba prototypů a vývoj dílů na zakázku",
    seoDescription:
      "Vývoj a výroba prototypů kovových dílů a sestav: konstrukce, 5osé CNC obrábění, ověření obrobitelnosti a měření složitých tvarů. Zkracujeme čas vývoje.",
    icon: "prototype",
    lead: "Nápad se mění v realitu. Podporujeme projekty od návrhu přes konstrukci až po finální prototyp – a zkracujeme čas vývoje.",
    body: [
      "Hlavní činností našeho týmu je precizní nástrojářská CNC výroba prototypů a komplexní obrábění. Zaměřujeme se na výrobu a vývoj nových prototypových i mechanických součástí v souladu s nejnovějšími technologickými trendy.",
      "Na strojích z prototypového centra nabízíme i zkoušky externím subjektům: ověření konstrukce (výroba prototypů), měření složitých tvarů a ověření technologické obrobitelnosti.",
    ],
    bullets: [
      "Prototypy kovových dílů a sestav",
      "Ověření konstrukce a obrobitelnosti",
      "Měření složitých tvarů",
      "Plynulý přechod z prototypu do série",
    ],
    keywords: ["výroba prototypů", "prototypová výroba", "vývoj prototypů", "prototypové díly"],
    machines: ["axile-g8", "hypertun-65", "fanuc-robocut"],
  },
  {
    slug: "programovani-a-konstrukce",
    title: "Konstrukce a CNC programování",
    short: "CAD/CAM konstrukce v ZW3D, Esprit, Cami a NCG CAM. Programování i pro externí zákazníky.",
    seoTitle: "Strojní konstrukce a CNC programování na zakázku",
    seoDescription:
      "Strojní konstrukce a CAM programování CNC strojů v ZW3D, Esprit, Cami a NCG CAM. Konstruujeme přípravky, nástroje i stroje, programujeme i pro externí firmy.",
    icon: "cad",
    lead: "Od roku 2013 pracujeme s CAD/CAM systémem ZW3D. Konstruujeme přípravky, nástroje, stroje i prototypy – a programujeme i pro externí zákazníky.",
    body: [
      "Přes ZW3D programujeme většinu našich obráběcích center a kreslíme a konstruujeme přípravky, nástroje, stroje i prototypy. Kromě ZW3D programujeme v softwarech Esprit, Cami a NCG CAM.",
      "Mimo programování pro interní účely nabízíme programování i externím zákazníkům. Můžete nám dodat vlastní výkresy, nebo s našimi konstruktéry vyvinout optimální řešení.",
    ],
    bullets: ["CAD konstrukce a výkresová dokumentace", "CAM programování 3–5 os", "Postprocesory a optimalizace drah", "Programování pro externí firmy"],
    keywords: ["CNC programování", "CAM programování", "strojní konstrukce", "ZW3D", "Esprit"],
  },
  {
    slug: "mereni-a-kontrola-kvality",
    title: "Měření a kontrola kvality",
    short: "100% výstupní kontrola, měřicí protokol ke každému dílu, 3D měření s přesností až 2 µm.",
    seoTitle: "Měření a kontrola kvality – 3D měření, měřicí protokoly",
    seoDescription:
      "100% výstupní kontrola, měřicí protokol ke každému dílu a 3D měření automatickými sondami s přesností až 2 µm. Řízení kvality dle ISO 9001.",
    icon: "measure",
    lead: "Každý díl odchází změřený. Ke každému kusu z kusové a prototypové výroby máme měřicí protokol – dohledatelný i měsíce zpětně.",
    body: [
      "Společnost je certifikována v řízení kvality dle ISO 9001. Výrobky všeho druhu podléhají přísné 100% výstupní kontrole a lze tak až několik měsíců zpětně dohledat a deklarovat skutečnou hodnotu jednotlivých rozměrů.",
      "Na vyžádání měříme automatickými 3D sondami s řádnými výstupními protokoly, u nichž lze garantovat přesnost až ve dvou mikronech. Disponujeme řadou kalibrů, měrek a speciálních měřidel pravidelně kalibrovaných v externích laboratořích.",
      "Měření provádějí dvě nezávislé osoby – s ohledem na možnost selhání lidského faktoru.",
    ],
    bullets: [
      "100% výstupní kontrola",
      "Měřicí protokol ke každému dílu",
      "3D měření s přesností až 2 µm",
      "Kontrola dvěma nezávislými osobami",
      "Kalibrovaná měřidla (externí laboratoře)",
    ],
    keywords: ["měření kvality", "3D měření", "měřicí protokol", "kontrola kvality", "ISO 9001"],
    legacy: ["/cz/technologie/mereni-a-kontrola-kvality"],
  },
  {
    slug: "konsignacni-skladovani",
    title: "Konsignační sklad a logistika",
    short: "Vaše díly vždy po ruce. Konsignační skladování, urgentní výroba a logistická podpora.",
    seoTitle: "Konsignační skladování dílů a logistická podpora",
    seoDescription:
      "Konsignační a flexibilní skladování vyráběných dílů, urgentní výroba a logistická podpora pro stálé odběratele. Vaše výroba nebude čekat na díly.",
    icon: "stock",
    lead: "Kritické díly držíme připravené pro vás. Odebíráte, až je potřebujete – bez vázání kapitálu ve vlastním skladu.",
    body: [
      "Nabízíme flexibilní a konsignační skladování, které zajišťuje rychlý přístup k potřebným komponentům. Stálým odběratelům poskytujeme urgentní výrobu, konsignační skladování i logistickou podporu.",
    ],
    bullets: ["Konsignační sklad u nás", "Odvolávky dle potřeby výroby", "Urgentní výroba pro stálé partnery", "Logistická podpora a doprava"],
    keywords: ["konsignační sklad", "skladování dílů", "logistika dílů"],
  },
];

export type Machine = {
  id: string;
  name: string;
  type: string;
  image?: string;
  description: string;
  specs: [string, string][];
  euProject?: string;
};

export const MACHINES: Machine[] = [
  {
    id: "axile-g8",
    name: "AXILE G8",
    type: "Pětiosé obráběcí centrum",
    image: "/img/axile-g8.png",
    description:
      "Velké frézovací centrum pro kontinuální pětiosé obrábění obrobků do Ø 1 000 mm. Oboustranně uložená kolébka, dva motory v ose Y, HEIDENHAIN iTNC640, sondy pro měření obrobků a laserové měření nástrojů.",
    specs: [
      ["Max. průměr obrobku", "1 000 mm"],
      ["Zatížení stolu", "3 000 kg"],
      ["Přejezdy X / Y / Z", "800 / 850 / 550 mm"],
      ["Osy A / C", "±120° / 380°"],
      ["Otáčky vřetena", "15 000 min⁻¹"],
      ["Počet nástrojů", "120"],
      ["Průměr stolu", "800 mm"],
      ["Kužel vřetena", "HSK 63A"],
    ],
    euProject: "„Vybavení nového prototypového centra společnosti MNástrojárna s.r.o.“, reg. č. CZ.01.1.02/0.0/0.0/17_093/0012410",
  },
  {
    id: "hypertun-65",
    name: "HYPERTUN 65 Powermill",
    type: "Dvouvřetenový soustruh + 5osé frézovací centrum",
    image: "/img/hypertun-65.jpg",
    description:
      "Dvouvřetenový, dvoukanálový soustruh s výkonným pětiosým frézovacím vřetenem a zásobníkem na 104 nástrojů. Sinumerik 840D, programování v Esprit. Sloučí více operací do jednoho cyklu.",
    specs: [
      ["Max. točná délka", "1 150 mm"],
      ["Oběžný průměr nad ložem", "500 mm"],
      ["Vzdálenost mezi vřeteny", "1 300 mm"],
      ["Průchod vřetenem", "64 mm"],
      ["Velikost sklíčidla", "250 mm"],
      ["Otáčky vřeten", "5 000 min⁻¹ (osa C)"],
      ["Frézovací hlava", "12 000 min⁻¹"],
      ["Nástrojů v zásobníku", "104"],
    ],
    euProject: "„Vybavení prototypové dílny společnosti Mnástrojárna s.r.o.“, reg. č. CZ.01.1.02/0.0/0.0/16_092/0010019",
  },
  {
    id: "fanuc-robocut",
    name: "FANUC ROBOCUT α-C800iB",
    type: "Elektroerozivní drátořez",
    image: "/img/fanuc-robocut.jpg",
    description:
      "Velký drátořez pro přesné řezání drátem od Ø 0,1 mm až v pěti osách. Programování v softwaru Cami pro složité tvary řezané v pěti osách současně.",
    specs: [
      ["Max. obrobek", "1 250 × 975 × 500 mm"],
      ["Přejezdy X / Y / Z", "800 × 600 × 510 mm"],
      ["Průměr drátu", "od 0,1 mm"],
      ["Řezání", "až v 5 osách"],
    ],
    euProject: "„Vybavení nového prototypového centra společnosti MNástrojárna s.r.o.“, reg. č. CZ.01.1.02/0.0/0.0/17_093/0012410",
  },
  {
    id: "mcv-754q",
    name: "MCV 754Q",
    type: "Vertikální obráběcí centrum",
    image: "/img/mcv-754q.jpg",
    description:
      "Obráběcí centrum s vysokou tuhostí a přesností díky pravítkům zpětného odměřování HEIDENHAIN. Litinový rám tvaru C, řízení HEIDENHAIN iTNC530 HSCI, zásobník 24 nástrojů s mechanickou rukou.",
    specs: [
      ["Přejezdy X / Y / Z", "754 / 500 / 550 mm"],
      ["Plocha stolu", "1 000 × 500 mm"],
      ["Zatížení stolu", "400 kg"],
      ["Otáčky vřetena", "10 000 min⁻¹"],
      ["Počet nástrojů", "24"],
      ["Kužel vřetena", "ISO 40"],
    ],
  },
  {
    id: "vmca-760",
    name: "VMCA 760",
    type: "Tříosé frézovací centrum",
    image: "/img/vmca-760.jpg",
    description:
      "Spolehlivé tříosé frézovací centrum pro frézování, vrtání, vyvrtávání i přímé řezání závitů. Řídicí systém Fagor pro produktivní kusovou výrobu.",
    specs: [
      ["Přejezdy X / Y / Z", "760 / 440 / 460 mm"],
      ["Plocha stolu", "900 × 410 mm"],
      ["Zatížení stolu", "350 kg"],
      ["Otáčky vřetena", "8 000 min⁻¹"],
      ["Kužel vřetena", "ISO 40"],
    ],
  },
  {
    id: "sab-50",
    name: "SAB 50 CNC",
    type: "CNC soustruh",
    description:
      "Vysokoproduktivní soustruh se šikmým ložem a lineárními vedeními. Vysoká spolehlivost, přesnost a jednoduchá obsluha systému Fagor.",
    specs: [["Konstrukce", "šikmé lože, lineární vedení"], ["Řízení", "Fagor"]],
  },
  {
    id: "konvencni",
    name: "Konvenční stroje",
    type: "Doplňkové obrábění",
    description: "Doplňkově se věnujeme i konvenčním metodám: soustruh SV18RA, frézka FA3V, bruska na plocho BPH20 a další.",
    specs: [["Soustruh", "SV18RA"], ["Frézka", "FA3V"], ["Bruska na plocho", "BPH20"]],
  },
];

export const STATS: { value: number; prefix?: string; suffix: string; label: string; decimals?: number }[] = [
  { value: 1000, prefix: "Ø ", suffix: " mm", label: "max. průměr obrobku v 5 osách" },
  { value: 2, suffix: " µm", label: "přesnost 3D měření" },
  { value: 3000, suffix: " kg", label: "zatížení stolu 5osého centra" },
  { value: 100, suffix: " %", label: "výstupní kontrola s protokolem" },
];

export const PROCESS = [
  { t: "Poptávka", d: "Pošlete výkres nebo 3D model přes formulář. Stačí PDF, STEP nebo DXF." },
  { t: "Technická analýza", d: "Technolog posoudí vyrobitelnost, materiál a technologii – a navrhne úspory." },
  { t: "Cenová nabídka", d: "Dostanete přehlednou nabídku s cenou a závazným termínem dodání." },
  { t: "Výroba a kontrola", d: "Vlastní výroba, 100% výstupní kontrola, měřicí protokol ke každému dílu." },
  { t: "Dodání", d: "Díl včas, s dokumentací. Opakované díly můžeme držet v konsignačním skladu." },
];

export const PROMISES = [
  { t: "Vždy v termínu", d: "Vlastní výroba bez subdodavatelských řetězců. Držíme slovo i tam, kde ostatní nestíhají." },
  { t: "Ručíme za výsledek", d: "Konstrukci, výrobu i montáž děláme sami, a proto za kvalitu i termín ručíme." },
  { t: "ISO 9001 a 14001", d: `Certifikovaný systém řízení kvality a environmentu od roku 2017.` },
  { t: "Férový přístup", d: "Otevřená komunikace, dodržování dohodnutých podmínek a individuální péče." },
];

export const INDUSTRIES = [
  {
    t: "Hygienické a netkané výrobky",
    d: "Válce, nože, formátovací díly a přípravky pro vysokorychlostní linky.",
  },
  { t: "Obaly, papír a tisk", d: "Válečky, hřídele, vodicí a řezné komponenty, náhradní díly strojů." },
  { t: "Plasty, lisování a média", d: "Formy, vložky, lisovací a střižné nástroje, upínací přípravky." },
  { t: "Potravinářství a nápoje", d: "Nerezové díly, formátové sady a jednoúčelová zařízení linek." },
  { t: "Energetika a těžký průmysl", d: "Velké obrobky do Ø 1 000 mm a 3 000 kg, přesné hřídele a příruby." },
  { t: "Výzkum, vývoj a automatizace", d: "Prototypy, jednoúčelové stroje a spolupráce s univerzitami." },
];

export const FAQ = [
  {
    q: "Jaká je minimální velikost zakázky?",
    a: `Zaměřujeme se výhradně na B2B projekty od 50 000 Kč bez DPH. Nejlépe nám sedí dlouhodobá spolupráce, rámcové smlouvy a projekty v řádu stovek tisíc až milionů korun. Zakázky pro soukromé osoby a drobné opravy nepřijímáme.`,
  },
  {
    q: "Co potřebujete k vypracování nabídky?",
    a: "Ideálně výkres (PDF) a 3D model (STEP), požadovaný materiál, počet kusů a termín. Pokud dokumentaci nemáte kompletní, náš technolog s vámi zbytek dořeší.",
  },
  {
    q: "Jak rychle dostanu cenovou nabídku?",
    a: "Poptávku po přijetí posoudí technolog a ozve se vám obchodní zástupce. U běžných dílů máte nabídku zpravidla do několika pracovních dnů, u komplexních projektů vás předem informujeme o termínu.",
  },
  {
    q: "Jak velké díly dokážete vyrobit?",
    a: "Na pětiosém centru AXILE G8 obrábíme obrobky až do průměru 1 000 mm a hmotnosti 3 000 kg, drátem řežeme obrobky až 1 250 × 975 × 500 mm, soustružíme do délky 1 150 mm.",
  },
  {
    q: "Dodáváte měřicí protokoly?",
    a: "Ano. Každý díl prochází 100% výstupní kontrolou a ke každému dílu z kusové a prototypové výroby máme měřicí protokol. Na vyžádání měříme 3D sondami s přesností až 2 µm.",
  },
  {
    q: "Pracujete i pro zahraniční firmy?",
    a: "Ano, dodáváme českým i zahraničním partnerům. Pelhřimov leží ve středu ČR mezi Prahou a Brnem, s dobrou dostupností do celé střední Evropy.",
  },
  {
    q: "Je moje dokumentace v bezpečí?",
    a: "Výkresy a modely zpracováváme důvěrně a používáme je výhradně pro přípravu nabídky a výrobu. Na přání podepíšeme NDA ještě před zasláním dat.",
  },
];

export const NAV = [
  { href: "/sluzby", label: "Služby" },
  { href: "/strojovy-park", label: "Strojový park" },
  { href: "/kvalita", label: "Kvalita" },
  { href: "/o-nas", label: "O nás" },
  { href: "/kontakt", label: "Kontakt" },
];

export function serviceBySlug(slug: string) {
  return SERVICES.find((s) => s.slug === slug);
}
export function machineById(id: string) {
  return MACHINES.find((m) => m.id === id);
}
