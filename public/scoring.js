// Scoring shared by the game and by tools/build.mjs.

// simA / simB are cosine similarities between the guess and each anchor.
// ceiling is the pair's bar for full relevance (see pairCeiling).
//   balance   - the smaller side's share, doubled, so a 50:50 split is 1
//   relevance - how close the guess sits to both anchors, capped at 1
export function score(simA, simB, ceiling) {
  const a = Math.max(simA, 0);
  const b = Math.max(simB, 0);
  const sum = a + b;
  if (sum === 0) return { share: 0.5, balance: 0, relevance: 0, total: 0 };
  const balance = (2 * Math.min(a, b)) / sum;
  const relevance = Math.min(sum / 2 / ceiling, 1);
  return { share: a / sum, balance, relevance, total: 100 * balance * relevance };
}

// A guess that is just a form of an anchor ("oceans", "oceanic") is not allowed.
export function related(word, ...anchors) {
  return anchors.some((x) => word === x || word.startsWith(x) || x.startsWith(word));
}

// The bar for full relevance differs per pair: it is the strongest "weaker link"
// any allowed word manages, so cat/dog and tax/volcano are both winnable.
export function pairCeiling(words, simsA, simsB, a, b) {
  let ceiling = 0;
  for (let i = 0; i < words.length; i++) {
    const weakest = Math.min(simsA[i], simsB[i]);
    if (weakest > ceiling && !related(words[i], a, b)) ceiling = weakest;
  }
  return ceiling;
}
