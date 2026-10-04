// Builds the static data the game scores against:
//   public/data/vocab.txt    playable words, most common first (line number = frequency rank)
//   public/data/vectors.bin  one int8 vector of DIM components per word
//   public/data/pairs.json   daily anchor pairs, grouped into five difficulty tiers
//
// Usage: node tools/build.mjs path/to/numberbatch-en-19.08.txt.gz
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { cuss } from 'cuss';
import { score, related, pairCeiling } from '../public/scoring.js';

const require = createRequire(import.meta.url);
const subtlex = require('subtlex-word-frequencies');
const dictionary = new Set(require('an-array-of-english-words'));

const DIM = 300;
const VOCAB_SIZE = 20000;
const OUT = new URL('../public/data/', import.meta.url);

const STOPWORDS = new Set(`the and you that was for are with his they this have from one had not but what all were
when your can said there use each which she how their will other about out many then them these some her would make
like him into has two more could been who its now than did get may over such very just much also too any those
does doing done being our ours myself yourself himself herself itself themselves here where why whom whose
should shall might must ought upon onto off yes yeah okay hey gonna gotta wanna ain because though although while
until unless since either neither nor both per via etc got goes went gone was were been let lets say says thing
things something anything nothing everything someone anyone everyone nobody somebody anybody everybody`.split(/\s+/));

const source = process.argv[2];
if (!source) throw new Error('Pass the path to numberbatch-en-19.08.txt.gz');

// 1. Candidate words: common, real, clean, and not a plain plural of another candidate.
const singularOf = (w) => {
  if (w.endsWith('ies') && dictionary.has(w.slice(0, -3) + 'y')) return w.slice(0, -3) + 'y';
  if (w.endsWith('es') && dictionary.has(w.slice(0, -2))) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && dictionary.has(w.slice(0, -1))) return w.slice(0, -1);
  return null;
};
// Ordinary words the profanity list is too strict about.
const ALLOWED = new Set('stupid dumb idiot moron loser sucker spit slave welfare vomit cocky chunky kumquat beanbag'.split(' '));
const wanted = new Set();
for (const entry of subtlex) {
  const word = entry.word.toLowerCase();
  if (!/^[a-z]{3,}$/.test(word)) continue;
  if (!dictionary.has(word) || STOPWORDS.has(word)) continue;
  if (cuss[word] === 2 && !ALLOWED.has(word)) continue;
  if (singularOf(word)) continue;
  wanted.add(word);
}
const candidates = [...wanted];

// 2. Pull those words' vectors out of Numberbatch.
const found = new Map();
const lines = createInterface({ input: createReadStream(source).pipe(createGunzip()) });
for await (const line of lines) {
  const space = line.indexOf(' ');
  const word = line.slice(0, space);
  if (!wanted.has(word)) continue;
  const v = Float32Array.from(line.slice(space + 1).split(' '), Number);
  if (v.length !== DIM) continue;
  found.set(word, v);
}

const vocab = candidates.filter((w) => found.has(w)).slice(0, VOCAB_SIZE);
const index = new Map(vocab.map((w, i) => [w, i]));

// 3. Quantise. Cosine similarity ignores scale, so each vector uses its full int8 range.
const bytes = new Int8Array(vocab.length * DIM);
const unit = new Float32Array(vocab.length * DIM);
vocab.forEach((w, i) => {
  const v = found.get(w);
  const peak = v.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1;
  let norm = 0;
  for (let d = 0; d < DIM; d++) {
    const q = Math.round((v[d] / peak) * 127);
    bytes[i * DIM + d] = q;
    norm += q * q;
  }
  norm = Math.sqrt(norm) || 1;
  for (let d = 0; d < DIM; d++) unit[i * DIM + d] = bytes[i * DIM + d] / norm;
});

const sims = (i) => {
  const out = new Float32Array(vocab.length);
  for (let j = 0; j < vocab.length; j++) {
    let s = 0;
    for (let d = 0; d < DIM; d++) s += unit[i * DIM + d] * unit[j * DIM + d];
    out[j] = s;
  }
  return out;
};

// 4. Pairs: drop any with a missing anchor, tier by anchor similarity, shuffle within tiers.
const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pairs = [];
for (const line of readFileSync(new URL('./pairs.txt', import.meta.url), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [a, b] = line.trim().split(/\s+/);
  if (!index.has(a) || !index.has(b)) {
    console.warn(`skipping "${a} ${b}": anchor not in vocabulary`);
    continue;
  }
  const sa = sims(index.get(a));
  const sb = sims(index.get(b));
  const ceiling = pairCeiling(vocab, sa, sb, a, b);
  const ranked = vocab
    .map((w, i) => ({ w, s: related(w, a, b) ? 0 : score(sa[i], sb[i], ceiling).total }))
    .sort((x, y) => y.s - x.s);
  pairs.push({ a, b, closeness: sa[index.get(b)], best: ranked.slice(0, 6) });
}
pairs.sort((x, y) => y.closeness - x.closeness);
const TIERS = 5;
const per = Math.floor(pairs.length / TIERS);
const rand = mulberry32(142);
const tiers = [];
for (let t = 0; t < TIERS; t++) {
  const tier = pairs.slice(t * per, (t + 1) * per);
  for (let i = tier.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tier[i], tier[j]] = [tier[j], tier[i]];
  }
  tiers.push(tier.map(({ a, b }) => [a, b]));
}

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('vocab.txt', OUT), vocab.join('\n'));
writeFileSync(new URL('vectors.bin', OUT), bytes);
writeFileSync(new URL('pairs.json', OUT), JSON.stringify({ dim: DIM, tiers }));

console.log(`${vocab.length} words, ${(bytes.length / 1e6).toFixed(1)} MB of vectors, ${per} pairs per tier`);
for (const p of pairs) {
  const best = p.best.map((x) => `${x.w} ${x.s.toFixed(0)}`).join(', ');
  console.log(`${p.closeness.toFixed(2)}  ${p.a} ↔ ${p.b}:  ${best}`);
}
