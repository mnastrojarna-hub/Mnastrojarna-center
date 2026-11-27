// Průchody e2e s WebGL a bez WebGL v jednom volání sady (vlna 22, bod 23: „fungoval softwarový náhled, řez a video v řezu“ –
// majitel testoval BEZ WebGL, takže průchod bez WebGL musí běžet v každém standardním běhu, ne jen když si ho někdo vyžádá).
//
// Výchozí stav (bez proměnné) = OBA průchody: nejdřív WebGL, pak bez WebGL. E2E_NOGL=1 = jen bez WebGL (staré řetězce, které
// sadu pouštějí podruhé s E2E_NOGL=1, dál fungují), E2E_NOGL=0 = jen WebGL (ladění). Jiná hodnota je chyba, ne tichý výchozí stav.
// Sdílí ji e2e sada (cad-w22-v.e2e.cjs) i test v Node (src/cad/w22/e2e-passes-v.test.ts).

const NO_GL = ['--disable-3d-apis', '--disable-webgl', '--disable-webgl2', '--disable-gpu'];
const GL = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

/** průchody podle proměnných prostředí: [{ id, nogl, args, tag }] */
function glPasses(env) {
  const v = env && env.E2E_NOGL != null ? String(env.E2E_NOGL).trim() : '';
  const webgl = { id: 'webgl', nogl: false, args: GL, tag: '' };
  const nogl = { id: 'nogl', nogl: true, args: NO_GL, tag: ' (bez WebGL)' };
  if (v === '') return [webgl, nogl];
  if (v === '1') return [nogl];
  if (v === '0') return [webgl];
  throw new Error(`E2E_NOGL="${v}" – povoleno: nic (oba průchody), 1 (jen bez WebGL), 0 (jen WebGL)`);
}

module.exports = { glPasses, GL, NO_GL };
