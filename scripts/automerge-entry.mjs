import * as Automerge from '@automerge/automerge/slim';

const wasmUrl = 'https://cdn.jsdelivr.net/npm/@automerge/automerge@3.2.5/dist/automerge.wasm';
const localWasmUrl = '/automerge.wasm';

globalThis.__handlBootMark?.('automerge-loader-start');
await Automerge.initializeWasm(loadWasm());
globalThis.__handlBootMark?.('automerge-loader-loaded');

export default Automerge;
export const automergeReady = Promise.resolve(Automerge);

async function loadWasm() {
  try {
    return await fetchWasm(wasmUrl);
  } catch (error) {
    return fetchWasm(localWasmUrl);
  }
}

async function fetchWasm(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Failed to load Automerge wasm from ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}
