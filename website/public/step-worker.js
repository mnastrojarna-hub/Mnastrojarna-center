/* Web worker: převod STEP/IGES → trojúhelníková síť přes OpenCascade (occt-import-js, WebAssembly).
   Vše běží lokálně v prohlížeči — soubor se nikam neodesílá. */
let occtPromise = null;

function loadOcct(base) {
  if (!occtPromise) {
    importScripts(base + "occt-import-js.js");
    // eslint-disable-next-line no-undef
    occtPromise = occtimportjs({ locateFile: (p) => base + p });
    occtPromise.catch(() => (occtPromise = null));
  }
  return occtPromise;
}

self.onmessage = async (e) => {
  const { id, base, name, buffer } = e.data;
  try {
    const occt = await loadOcct(base);
    const ext = String(name).split(".").pop().toLowerCase();
    const bytes = new Uint8Array(buffer);
    const params = { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.35 };
    const res = ext === "igs" || ext === "iges" ? occt.ReadIgesFile(bytes, params) : occt.ReadStepFile(bytes, params);
    if (!res || !res.success) throw new Error("Soubor se nepodařilo přečíst (poškozený nebo nepodporovaný STEP/IGES).");
    const meshes = [];
    const transfer = [];
    for (const m of res.meshes) {
      const position = new Float32Array(m.attributes.position.array);
      const index = new Uint32Array(m.index.array);
      const normal = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
      meshes.push({ name: m.name || "", color: m.color || null, position, index, normal });
      transfer.push(position.buffer, index.buffer);
      if (normal) transfer.push(normal.buffer);
    }
    self.postMessage({ id, ok: true, meshes }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
