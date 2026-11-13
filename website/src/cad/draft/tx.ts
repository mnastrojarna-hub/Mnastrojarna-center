/**
 * Transakce nad 2D modelem: příkaz pracuje s pracovní kopií (přidat / změnit / smazat entity, proměnné, tabulky)
 * a na konci vznikne nový neměnný model = jeden krok historie zpět / znovu. Eviduje vytvořené, změněné a smazané entity
 * (výsledek pro agenti, „poslední“ výběr).
 *
 * Výkon: seznam entit prostoru se nekopíruje při každé změně – nové entity se připojují (`added`), změny a smazání
 * se drží v mapě (`replaced`) a nový seznam se sestaví až při čtení `model` (jedno spojení polí). Skript s desítkami
 * tisíc příkazů tak zůstane lineární.
 */
import { tr } from "../i18n";
import { ensureLinetype, findLayer } from "./layers";
import { entityById, spaceEntities, withSpaceEntities, type DraftEntity, type DraftModel, type DraftSpace, type DraftVars, type NewEntity } from "./model";

export class DraftTx {
  private base: DraftModel;
  /** model se sestaveným seznamem entit (bez rozpracovaných změn) */
  private cur: DraftModel;
  /** seznam entit prostoru v `cur` */
  private baseList: DraftEntity[];
  /** nové entity (pořadí vzniku) */
  private added: DraftEntity[] = [];
  private addedIdx = new Map<string, number>();
  /** změněné (entita) a smazané (null) entity seznamu `baseList` */
  private replaced = new Map<string, DraftEntity | null>();
  readonly space: DraftSpace;
  private cSet = new Set<string>();
  private chSet = new Set<string>();
  private dList: string[] = [];
  private seq: number;

  constructor(model: DraftModel, space: DraftSpace = "model") {
    this.base = model;
    this.cur = model;
    this.space = spaceEntities(model, space) ? space : "model";
    this.baseList = spaceEntities(model, this.space) ?? [];
    this.seq = model.seq;
  }

  /** id vytvořených entit (v pořadí vzniku) */
  get created(): string[] {
    return [...this.cSet];
  }
  /** id změněných (dříve existujících) entit */
  get changed(): string[] {
    return [...this.chSet];
  }
  /** id smazaných (dříve existujících) entit */
  get deleted(): string[] {
    return [...this.dList];
  }

  private get pending() {
    return this.added.length > 0 || this.replaced.size > 0;
  }

  /** aktuální stav modelu (včetně dosavadních změn) */
  get model(): DraftModel {
    if (this.pending) {
      let list: DraftEntity[];
      if (this.replaced.size) {
        list = [];
        for (const e of this.baseList) {
          if (!this.replaced.has(e.id)) list.push(e);
          else {
            const r = this.replaced.get(e.id);
            if (r) list.push(r);
          }
        }
        for (const e of this.added) if (e) list.push(e);
      } else list = this.baseList.concat(this.added);
      this.cur = { ...withSpaceEntities(this.cur, this.space, list), seq: this.seq };
      this.baseList = list;
      this.added = [];
      this.addedIdx.clear();
      this.replaced.clear();
    } else if (this.cur.seq !== this.seq) this.cur = { ...this.cur, seq: this.seq };
    return this.cur;
  }
  get original(): DraftModel {
    return this.base;
  }
  get dirty(): boolean {
    return this.model !== this.base;
  }
  /** proměnné výkresu (bez sestavení modelu) */
  get vars(): DraftVars {
    return this.cur.vars;
  }
  /** entity aktuálního prostoru */
  get entities(): readonly DraftEntity[] {
    return spaceEntities(this.model, this.space) ?? [];
  }
  get(id: string): DraftEntity | undefined {
    const ai = this.addedIdx.get(id);
    if (ai !== undefined) return this.added[ai] ?? undefined;
    if (this.replaced.has(id)) return this.replaced.get(id) ?? undefined;
    return entityById(this.baseList, id);
  }
  private locked(e: DraftEntity) {
    return !!findLayer(this.cur, e.layer)?.locked && !this.cSet.has(e.id);
  }
  newId(): string {
    this.seq += 1;
    return `e${this.seq}`;
  }
  /**
   * Přidá entitu: id se přidělí, chybí-li hladina, použije se aktuální (CLAYER) a aktuální barva / typ / tloušťka
   * (CECOLOR, CELTYPE, CELWEIGHT, CELTSCALE), pokud nejsou ByLayer.
   */
  add(ne: NewEntity): string {
    const v = this.cur.vars;
    const id = ne.id && !this.get(ne.id) ? ne.id : this.newId();
    const layer = findLayer(this.cur, ne.layer ?? v.clayer);
    if (!layer) throw new Error(tr("hladina „{0}“ neexistuje", ne.layer ?? v.clayer));
    const e = { ...ne, id, layer: layer.name } as DraftEntity;
    if (e.color === undefined && v.cecolor !== "ByLayer") e.color = v.cecolor;
    if (e.linetype === undefined && !/^bylayer$/i.test(v.celtype)) e.linetype = v.celtype;
    if (e.lineweight === undefined && v.celweight !== "ByLayer") e.lineweight = v.celweight;
    if (e.ltscale === undefined && v.celtscale !== 1) e.ltscale = v.celtscale;
    this.addedIdx.set(id, this.added.length);
    this.added.push(e);
    this.cSet.add(id);
    return id;
  }
  /** nahradí entitu změněnou kopií (stejné id); zamčená hladina = chyba (`force` = i tak) */
  put(e: DraftEntity, force = false): void {
    const old = this.get(e.id);
    if (!old) throw new Error(tr("entita {0} neexistuje", e.id));
    if (!force && this.locked(old)) throw new Error(tr("entita {0} je na zamčené hladině „{1}“", e.id, old.layer));
    const ai = this.addedIdx.get(e.id);
    if (ai !== undefined) this.added[ai] = e;
    else this.replaced.set(e.id, e);
    if (!this.cSet.has(e.id)) this.chSet.add(e.id);
  }
  update(id: string, fn: (e: DraftEntity) => DraftEntity, force = false): void {
    const e = this.get(id);
    if (!e) throw new Error(tr("entita {0} neexistuje", id));
    const n = fn(e);
    if (n !== e) this.put({ ...n, id: e.id } as DraftEntity, force);
  }
  remove(id: string, force = false): void {
    const old = this.get(id);
    if (!old) return;
    if (!force && this.locked(old)) throw new Error(tr("entita {0} je na zamčené hladině „{1}“", id, old.layer));
    const ai = this.addedIdx.get(id);
    if (ai !== undefined) {
      // nově přidaná entita: vyjmout z přidaných
      this.added.splice(ai, 1);
      this.addedIdx.clear();
      this.added.forEach((x, i) => this.addedIdx.set(x.id, i));
      this.cSet.delete(id);
      return;
    }
    this.replaced.set(id, null);
    this.chSet.delete(id);
    this.dList.push(id);
  }
  /** změna celého modelu (tabulky hladin, typů čar, stylů, bloků…) */
  setModel(fn: (m: DraftModel) => DraftModel): void {
    const m = this.model;
    const n = fn(m);
    if (n === m) return;
    this.cur = n;
    this.baseList = spaceEntities(n, this.space) ?? [];
    this.seq = Math.max(this.seq, n.seq);
  }
  setVars(p: Partial<DraftVars>): void {
    this.setModel((m) => ({ ...m, vars: { ...m.vars, ...p } }));
  }
  /** ověří a případně z knihovny načte typ čáry – vrací kanonický název */
  linetype(name: string): string {
    let out = name;
    this.setModel((m) => {
      const [m2, n] = ensureLinetype(m, name);
      out = n;
      return m2;
    });
    return out;
  }
}
