import {initializeBase64Wasm, UseApi} from '/vendor/automerge/low_level.js';
import * as api from '/vendor/automerge/wasm_bindgen_output/web/automerge_wasm.js';
import * as Automerge from '/vendor/automerge/index.js';

import {automergeWasmBase64} from '/vendor/automerge/wasm_bindgen_output/web/automerge_wasm_bg_base64.js';

export const automergeReady = initializeBase64Wasm(automergeWasmBase64).then(() => {
  UseApi(api);
  globalThis.Automerge = Automerge;
  return Automerge;
});

export default Automerge;
export * from '/vendor/automerge/index.js';
