// Korpus parity enginu (CAD-HEADLESS-NAVRH.md kap. 2.4, balík B2): skripty `src/cad/engine/__corpus__/*.txt`, zlaté snímky
// `__corpus__/golden/*.txt` (protokol konzole `runAgentText` před přesunem smyčky do enginu) a normalizace, kterou sdílí
// e2e v prohlížeči (cad-engine-parity.e2e.cjs) i test v Node (src/cad/engine/parity.test.ts).
//
// Skript může mít víc běhů oddělených řádkem `#--- run` (komentář – parser ho přeskočí): každý běh = jedno volání
// `window.mncad.run` / `runScript` nad týmž pracovním prostorem (zpět/znovu, záložky a sestavy přes běhy).
// Normalizuje se jen to, co se mezi běhy mění samo: id prvků a komponent, časy výpočtu, čas kontroly kolizí, data.
const fs = require('fs');
const path = require('path');

const CORPUS_DIR = path.join(__dirname, '..', '..', 'src', 'cad', 'engine', '__corpus__');
const GOLDEN_DIR = path.join(CORPUS_DIR, 'golden');
const RUN_SEP = /^#--- run\s*$/m;

/** skripty korpusu seřazené podle názvu: { name, file, runs: string[] } */
function listCorpus(filter) {
  const re = filter ? new RegExp(filter) : null;
  return fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .filter((f) => !re || re.test(f))
    .map((f) => {
      const text = fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8').replace(/\r\n/g, '\n');
      return { name: f.replace(/\.txt$/, ''), file: f, runs: splitRuns(text) };
    });
}

/** běhy skriptu (oddělovač `#--- run`), každý bez koncových prázdných řádků */
function splitRuns(text) {
  return text.split(RUN_SEP).map((r) => r.replace(/^\n+|\s+$/g, '')).filter((r) => r.length > 0);
}

/** protokoly běhů jednoho skriptu jako jeden text (oddělovač s pořadím běhu) */
function joinRuns(outputs) {
  return outputs.map((o, i) => `=== run ${i + 1} ===\n${o}`).join('\n');
}

/**
 * Normalizace protokolu konzole: id prvků a komponent (7 znaků base36 z `uid()`), časy výpočtu prvků (` · 1,2 s`), řádek
 * „Výpočet modelu: … s“ (jen nad 2 s), čas kontroly kolizí, data a časy v textu. Nic jiného – rozdíl v číslech geometrie,
 * pořadí nebo textu hlášek je nález.
 */
/** id entity z textového příkazu (e1, e2, e1_1) – ostatní (uid normálií a JSON) se normalizují */
const isTextId = (id) => /^e\d+(_\d+)?$/.test(id);

function normalize(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !/^(Výpočet modelu|Model computation|Modellberechnung): [\d.,]+ s$/.test(l))
    .map((l) =>
      l
        // id entit skici z normálií / JSON bez textových id (e1, e2…): `entity: wrr398i 6-úhelník…`, `profil: … (wrr398i)`
        .replace(/^(\s+entity: .*)$/, (x) => x.replace(/(entity: |· )([a-z0-9_]+)(?= )/g, (m, p, id) => (isTextId(id) ? m : p + '#')))
        .replace(/^(\s+profil: .*)$/, (x) => x.replace(/\(([^()]*)\)/g, (m, inner) => '(' + inner.split('; ').map((id) => (/^[a-z0-9]{5,9}$/.test(id) && !isTextId(id) ? '#' : id)).join('; ') + ')'))
        .replace(/ · [\d.,]+ s$/, '')
        // doba výpočtu dynamické studie uprostřed řádku `Dynamika: … · výpočet 0,41 s` (vlna 21)
        .replace(/ · výpočet [\d.,]+ s(?= |$)/, '')
        // nápověda k neznámému příkazu = seznam příkazů z AGENT_COMMANDS (s novým příkazem se prodlouží) – jen jeho začátek
        .replace(/^(✗ řádek \d+: neznámý příkaz „[^“]*“ – příkazy: )(.*?)( ← „.*“)?$/, '$1…$3')
        .replace(/\bid [a-z0-9]{1,9}\]/g, 'id #]')
        .replace(/\bid ([a-z0-9]{1,9})([ ,;)])/g, 'id #$2')
        .replace(/\b(zkontrolováno|checked|geprüft) \d{1,2}:\d{2}(:\d{2})?( ?[AP]M)?/g, '$1 ?')
        // krátká revize modelu (vlna 22: otisk obsahu včetně náhodných id prvků) – `r·a1b2c3` → `r·?`
        .replace(/r·[0-9a-f]{6}\b/g, 'r·?')
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '????-??-??')
        .replace(/\b\d{1,2}\. ?\d{1,2}\. ?\d{4}\b/g, '?.?.????'),
    )
    .join('\n')
    .replace(/\s+$/, '');
}

/*
 * Korpus smlouvy B2 „prohlížeč = Node“ (`__corpus__/cross/*.txt`, oprava po recenzi): víc běhů nad týmž pracovním prostorem
 * (záložky z dřívějších běhů, přejmenování, stav vazeb a kolizí podle dokumentu, díl změněný v dřívějším běhu). Zlatý
 * snímek `cross/golden/<skript>.txt` je výstup enginu v Node (CROSS_UPDATE=1 vitest parity) a prohlížeč přes
 * `window.mncad.run` musí dát po normalizaci přesně totéž, včetně seznamu záložek (bez záložek výkresu) na konci.
 */
const CROSS_DIR = path.join(CORPUS_DIR, 'cross');
const CROSS_GOLDEN_DIR = path.join(CROSS_DIR, 'golden');
function listCross(filter) {
  const re = filter ? new RegExp(filter) : null;
  if (!fs.existsSync(CROSS_DIR)) return [];
  return fs
    .readdirSync(CROSS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .filter((f) => !re || re.test(f))
    .map((f) => ({ name: f.replace(/\.txt$/, ''), file: f, runs: splitRuns(fs.readFileSync(path.join(CROSS_DIR, f), 'utf8').replace(/\r\n/g, '\n')) }));
}
/** výstup skriptu korpusu cross: protokoly běhů + záložky (bez záložek výkresu) */
const joinCross = (outputs, tabs) => `${joinRuns(outputs)}\n=== tabs ===\n${tabs.join(' | ')}`;
const crossGoldenPath = (name) => path.join(CROSS_GOLDEN_DIR, name + '.txt');
const readCrossGolden = (name) => (fs.existsSync(crossGoldenPath(name)) ? fs.readFileSync(crossGoldenPath(name), 'utf8').replace(/\s+$/, '') : null);
function writeCrossGolden(name, text) {
  fs.mkdirSync(CROSS_GOLDEN_DIR, { recursive: true });
  fs.writeFileSync(crossGoldenPath(name), text.replace(/\s+$/, '') + '\n');
}

const goldenPath = (name) => path.join(GOLDEN_DIR, name + '.txt');
const readGolden = (name) => (fs.existsSync(goldenPath(name)) ? fs.readFileSync(goldenPath(name), 'utf8').replace(/\s+$/, '') : null);
function writeGolden(name, text) {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  fs.writeFileSync(goldenPath(name), text.replace(/\s+$/, '') + '\n');
}

/** rozdíl dvou textů po řádcích (LCS): [{ op: '=' | '-' | '+', a?, b? }] – `-` jen ve zlatém snímku, `+` jen ve výsledku */
function diffLines(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ op: '=', a: A[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: '-', a: A[i++] });
    else out.push({ op: '+', b: B[j++] });
  }
  while (i < n) out.push({ op: '-', a: A[i++] });
  while (j < m) out.push({ op: '+', b: B[j++] });
  return out;
}

/** prvních `max` rozdílných řádků jako text (pro hlášku FAIL) */
function diffText(golden, actual, max = 12) {
  const d = diffLines(golden, actual).filter((x) => x.op !== '=');
  return d.slice(0, max).map((x) => (x.op === '-' ? `  - ${x.a}` : `  + ${x.b}`)).join('\n') + (d.length > max ? `\n  … ${d.length - max} dalších` : '');
}

/** řádek bez 3D okna / jen v aplikaci, kterým Node nahrazuje řádek aplikace (ℹ ui.no-view, ✗ host.app-only) */
const HOST_LINE = /^(ℹ|✗) (řádek \d+: )?(bez 3D okna nemá příkaz účinek|příkaz funguje jen v aplikaci v prohlížeči)/;

/**
 * Zamýšlený rozdíl proti dnešní smyčce (smlouva B2 „ensureLeaves before status“): stav sestavy dřív bral obálku, objem Σ
 * a hmotnost Σ z mezipaměti aplikace, kterou plní efekt až po vykreslení – díly komponent vložených v témže běhu tam ještě
 * nebyly a údaj chyběl. Engine díly před stavem postaví, řádek „Sestava: …“ tak má navíc jen tyto údaje (nic jiného).
 */
const ASM_LINE = /^Sestava: \d+ komponent \(\d+ dílů po rozložení podsestav\)/;
const ASM_EXTRA = /^(obálka [\d ,]+ × [\d ,]+ × [\d ,]+ mm|objem Σ [\d ,]+ cm³|hmotnost Σ [\d ,]+ kg)$/;
function ensureLeavesDelta(golden, actual) {
  if (!ASM_LINE.test(golden) || !ASM_LINE.test(actual) || golden === actual) return false;
  const g = golden.split(' · ');
  const a = actual.split(' · ');
  let i = 0;
  for (const item of a) {
    if (i < g.length && item === g[i]) i++;
    else if (!ASM_EXTRA.test(item)) return false;
  }
  return i === g.length;
}

/**
 * Zamýšlený rozdíl 2 (smlouva B2 „ensureLeaves before status“ i pro sestavu vytvořenou v témže běhu – oprava po recenzi):
 * dnešní smyčka stav nové sestavy nepočítala vůbec („Sestava: tělesa komponent se stavějí zvlášť …“ a u vazeb „Vazby: N
 * (stav se přepočítá)“). Engine díly postaví a vypíše řádek „Sestava: N komponent …“, stav vazeb (týž počet vazeb) a řádek
 * „Kolize: …“ – blok rozdílu smí obsahovat jen tyto řádky.
 */
const NEW_ASM_OLD = /^Sestava: tělesa komponent se stavějí zvlášť \(objem a hmotnost viz kusovník\)$/;
const MATES_PENDING = /^Vazby: (\d+) \(stav se přepočítá\)$/;
const MATES_LINE = /^Vazby: (\d+) \(.+\)$/;
const CLASH_LINE = /^Kolize: /;
function newAsmDelta(minus, plus) {
  if (!minus.some((l) => NEW_ASM_OLD.test(l)) || !minus.every((l) => NEW_ASM_OLD.test(l) || MATES_PENDING.test(l))) return false;
  const pend = minus.filter((l) => MATES_PENDING.test(l));
  const mates = plus.filter((l) => MATES_LINE.test(l));
  if (mates.length !== pend.length || mates.some((l, i) => MATES_LINE.exec(l)[1] !== MATES_PENDING.exec(pend[i])[1])) return false;
  const asm = plus.filter((l) => ASM_LINE.test(l)).length;
  const clash = plus.filter((l) => CLASH_LINE.test(l)).length;
  return asm === minus.filter((l) => NEW_ASM_OLD.test(l)).length && clash === asm && plus.length === mates.length + asm + clash;
}

/**
 * Porovnání se zlatým snímkem. Blok rozdílu (souvislé řádky `-`/`+`) je povolený, když
 *  * je to zamýšlený rozdíl stavu sestavy (`ensureLeavesDelta`: řádek `-` a jeho `+` se liší jen doplněnou obálkou /
 *    objemem Σ / hmotností Σ; `newAsmDelta`: stav sestavy vytvořené v témže běhu) – počítá se do `deltas`;
 *  * jen v Node (`node: true`): obsahuje aspoň jeden řádek `HOST_LINE` a jinak jen řádky zlatého snímku (aplikace něco
 *    provedla ve 3D okně / stažením, Node místo toho vypíše kód) – počítá se do `subst`.
 * Vrací { ok, subst, deltas, text } (text = nepovolené řádky).
 */
function compare(golden, actual, o = {}) {
  const d = diffLines(golden, actual);
  let subst = 0;
  let deltas = 0;
  const bad = [];
  for (let k = 0; k < d.length; ) {
    if (d[k].op === '=') {
      k++;
      continue;
    }
    const block = [];
    while (k < d.length && d[k].op !== '=') block.push(d[k++]);
    const minus = block.filter((x) => x.op === '-');
    const plus = block.filter((x) => x.op === '+');
    if (minus.length === plus.length && minus.every((x, i) => ensureLeavesDelta(x.a, plus[i].b))) {
      deltas += minus.length;
      continue;
    }
    if (newAsmDelta(minus.map((x) => x.a), plus.map((x) => x.b))) {
      deltas += minus.filter((x) => NEW_ASM_OLD.test(x.a)).length;
      continue;
    }
    const host = plus.filter((x) => HOST_LINE.test(x.b));
    if (o.node && host.length && host.length === plus.length) {
      subst += host.length;
      continue;
    }
    bad.push(...block);
  }
  return { ok: bad.length === 0, subst, deltas, text: bad.slice(0, 12).map((x) => (x.op === '-' ? `  - ${x.a}` : `  + ${x.b}`)).join('\n') + (bad.length > 12 ? `\n  … ${bad.length - 12} dalších` : '') };
}
/** porovnání v Node (viz `compare`) */
const compareNode = (golden, actual) => compare(golden, actual, { node: true });

module.exports = { CORPUS_DIR, GOLDEN_DIR, CROSS_DIR, RUN_SEP, listCorpus, listCross, joinCross, readCrossGolden, writeCrossGolden, splitRuns, joinRuns, normalize, readGolden, writeGolden, diffLines, diffText, compare, compareNode, ensureLeavesDelta, newAsmDelta, HOST_LINE };
