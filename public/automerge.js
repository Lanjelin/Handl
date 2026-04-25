async function loadAutomerge() {
  if (globalThis.Automerge) return globalThis.Automerge;
  globalThis.__handlBootMark?.('automerge-loader-start');

  const response = await fetch('/vendor/automerge/fullfat_base64.cjs', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load Automerge bundle');
  }

  const source = await response.text();
  const module = { exports: {} };
  const bundleFactory = new Function('module', 'exports', `${source}\nreturn module.exports;`);
  const automergeExports = bundleFactory(module, module.exports);
  globalThis.Automerge = automergeExports;
  globalThis.__handlBootMark?.('automerge-loader-loaded');
  return automergeExports;
}

export const automergeReady = loadAutomerge();
export default await automergeReady;
