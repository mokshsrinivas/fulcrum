// Prints each pair's five best words, the same ones the game reveals.
// With --missing, prints only the words that have no entry in public/data/reasons.json.
import { readFileSync, existsSync } from 'node:fs';
import { score, related, pairCeiling } from '../public/scoring.js';

const data = (name) => new URL(`../public/data/${name}`, import.meta.url);
const words = readFileSync(data('vocab.txt'), 'utf8').split('\n');
const { dim, tiers } = JSON.parse(readFileSync(data('pairs.json'), 'utf8'));
const vectors = new Int8Array(readFileSync(data('vectors.bin')).buffer);
const reasons = existsSync(data('reasons.json')) ? JSON.parse(readFileSync(data('reasons.json'), 'utf8')) : {};
const onlyMissing = process.argv.includes('--missing');

const norms = words.map((_, i) => {
  let n = 0;
  for (let d = 0; d < dim; d++) n += vectors[i * dim + d] ** 2;
  return Math.sqrt(n) || 1;
});
const simsTo = (i) =>
  words.map((_, j) => {
    let s = 0;
    for (let d = 0; d < dim; d++) s += vectors[i * dim + d] * vectors[j * dim + d];
    return s / (norms[i] * norms[j]);
  });

for (const [a, b] of tiers.flat()) {
  const simsA = simsTo(words.indexOf(a));
  const simsB = simsTo(words.indexOf(b));
  const ceiling = pairCeiling(words, simsA, simsB, a, b);
  const ranked = words
    .map((word, i) => ({ word, total: related(word, a, b) ? 0 : score(simsA[i], simsB[i], ceiling).total }))
    .sort((x, y) => y.total - x.total);
  const picks = [];
  for (const r of ranked) {
    if (picks.some((p) => p.word.slice(0, 5) === r.word.slice(0, 5))) continue;
    picks.push(r);
    if (picks.length === 5) break;
  }
  const known = reasons[`${a}|${b}`] ?? {};
  const shown = picks.map((p) => p.word).filter((w) => !onlyMissing || !known[w]);
  if (shown.length) console.log(`${a}|${b}: ${shown.join(', ')}`);
}
