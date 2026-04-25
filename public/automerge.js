async function loadAutomerge() {
  if (globalThis.Automerge) return globalThis.Automerge;

  const [bundleResponse, wasmResponse] = await Promise.all([
    fetch('/vendor/automerge/slim.cjs', { cache: 'no-store' }),
    fetch('/vendor/automerge/automerge_wasm_bg.wasm', { cache: 'no-store' })
  ]);

  if (!bundleResponse.ok) {
    throw new Error('Failed to load Automerge bundle');
  }
  if (!wasmResponse.ok) {
    throw new Error('Failed to load Automerge wasm');
  }

  const bundleSource = await bundleResponse.text();
  const wasmBytes = new Uint8Array(await wasmResponse.arrayBuffer());
  const module = { exports: {} };
  const bundleFactory = new Function('module', 'exports', `${bundleSource}\nreturn module.exports;`);
  const automergeExports = bundleFactory(module, module.exports);

  await automergeExports.initializeWasm(wasmBytes);
  globalThis.Automerge = automergeExports;
  return automergeExports;
}

export const automergeReady = loadAutomerge();
export default await automergeReady;
