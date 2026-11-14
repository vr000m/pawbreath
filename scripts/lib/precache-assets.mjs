// The single parser for the precache list in dist/sw.js, shared by the release script and the tests.
export function parseAssets(workerSource) {
  const list = workerSource.match(/^const ASSETS = \[([^\]]*)\];$/m);
  if (!list) throw new Error('Worker asset list missing.');
  return [...list[1].matchAll(/'([^']*)'/g)].map(match => match[1]);
}
