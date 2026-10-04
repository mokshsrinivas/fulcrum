import { score, related, pairCeiling } from './scoring.js';

const EPOCH = new Date(2026, 9, 4); // local midnight of puzzle #1
const STORE = 'fulcrum:v1';
const RARITY = [
  [1500, 'Everyday word'],
  [5000, 'Common'],
  [10000, 'Uncommon'],
  [15000, 'Rare'],
  [Infinity, 'Deep cut'],
];

const app = document.getElementById('app');
const $ = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

// ---------- data ----------

let words, index, vectors, norms, dim, tiers;

async function load() {
  const [vocab, bin, pairs] = await Promise.all([
    fetch('data/vocab.txt').then((r) => r.text()),
    fetch('data/vectors.bin').then((r) => r.arrayBuffer()),
    fetch('data/pairs.json').then((r) => r.json()),
  ]);
  words = vocab.split('\n');
  index = new Map(words.map((w, i) => [w, i]));
  vectors = new Int8Array(bin);
  dim = pairs.dim;
  tiers = pairs.tiers;
  norms = new Float32Array(words.length);
  for (let i = 0; i < words.length; i++) {
    let n = 0;
    for (let d = 0; d < dim; d++) n += vectors[i * dim + d] ** 2;
    norms[i] = Math.sqrt(n) || 1;
  }
}

function simsTo(i) {
  const out = new Float32Array(words.length);
  for (let j = 0; j < words.length; j++) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += vectors[i * dim + d] * vectors[j * dim + d];
    out[j] = s / (norms[i] * norms[j]);
  }
  return out;
}

// "beaches" counts as "beach".
function lookup(raw) {
  const w = raw.toLowerCase().replace(/[^a-z]/g, '');
  const forms = [w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')];
  return forms.find((f) => index.has(f)) ?? null;
}

// Everything needed to score guesses against one pair.
function preparePair([a, b]) {
  const simsA = simsTo(index.get(a));
  const simsB = simsTo(index.get(b));
  const ceiling = pairCeiling(words, simsA, simsB, a, b);
  const evaluate = (word) => {
    const i = index.get(word);
    return { word, rank: i, ...score(simsA[i], simsB[i], ceiling), reach: (simsA[i] + simsB[i]) / 2 / ceiling };
  };
  // The model's best words, skipping near-duplicates like "twinkle" / "twinkling".
  const picks = [];
  const ranked = words
    .filter((w) => !related(w, a, b))
    .map(evaluate)
    .sort((x, y) => y.total - x.total);
  for (const r of ranked) {
    if (picks.some((p) => p.word.slice(0, 5) === r.word.slice(0, 5))) continue;
    picks.push(r);
    if (picks.length === 5) break;
  }
  return { a, b, evaluate, picks };
}

// ---------- persistence ----------

const today = () => {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((midnight - EPOCH) / 864e5) + 1;
};

function readStore() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? { days: {} };
  } catch {
    return { days: {} };
  }
}
function writeStore(store) {
  try {
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch {
    // Private windows may refuse storage; the game still plays.
  }
}

function stats(store) {
  const done = Object.entries(store.days).filter(([, d]) => d.total != null);
  const totals = done.map(([, d]) => d.total);
  const played = new Set(done.map(([n]) => Number(n)));
  let streak = 0;
  for (let n = played.has(today()) ? today() : today() - 1; played.has(n); n--) streak++;
  return {
    played: totals.length,
    streak,
    average: totals.length ? totals.reduce((s, x) => s + x, 0) / totals.length : 0,
    best: totals.length ? Math.max(...totals) : 0,
  };
}

// ---------- game ----------

let game;

function startDaily() {
  const day = today();
  const pairs = tiers.map((tier) => tier[(day - 1) % tier.length]);
  const saved = readStore().days[day]?.words ?? [];
  game = { mode: 'daily', day, pairs, results: [] };
  saved.forEach((word, i) => game.results.push(preparePair(pairs[i]).evaluate(word)));
  game.results.length === pairs.length ? renderFinal() : renderPrompt();
}

function startPractice() {
  game = { mode: 'practice', pairs: [], results: [] };
  nextPracticePair();
}

function nextPracticePair() {
  const tier = tiers[Math.floor(Math.random() * tiers.length)];
  game.pairs = [tier[Math.floor(Math.random() * tier.length)]];
  game.results = [];
  renderPrompt();
}

function submit(pair, word) {
  const result = pair.evaluate(word);
  game.results.push(result);
  if (game.mode === 'daily') {
    const store = readStore();
    const day = (store.days[game.day] ??= { words: [] });
    day.words.push(word);
    if (day.words.length === game.pairs.length) day.total = dailyTotal();
    writeStore(store);
  }
  renderResult(pair, result);
}

const dailyTotal = () => game.results.reduce((s, r) => s + r.total, 0) / game.results.length;

// ---------- views ----------

const fmt = (n) => n.toFixed(1);
const pct = (n) => `${Math.round(n * 100)}%`;

function header(round) {
  if (game.mode === 'practice') return `<div class="meta"><span>Practice</span><span>Not recorded</span></div>`;
  const dots = game.pairs
    .map((_, i) => `<i class="${i < round ? 'done' : i === round ? 'now' : ''}"></i>`)
    .join('');
  return `<div class="meta"><span>Fulcrum #${game.day} · Pair ${round + 1} of ${game.pairs.length}</span><span class="dots">${dots}</span></div>`;
}

const anchors = ({ a, b }) =>
  `<div class="anchors"><span class="a">${a}</span><span class="mid">↔</span><span class="b">${b}</span></div>`;

// Turns what the player typed into a playable word, or says why it isn't one.
function check(pair, raw) {
  const typed = raw.trim();
  if (/\s/.test(typed)) return { problem: 'One word only.' };
  const word = lookup(typed);
  if (!word) return { problem: `“${typed}” isn’t in the word list. Try a more common word.` };
  if (related(word, pair.a, pair.b)) return { problem: 'Too close to one of the anchors. Pick a different word.' };
  return { word };
}

function renderPrompt() {
  const round = game.results.length;
  const pair = preparePair(game.pairs[round]);
  const view = $(`
    <section class="card">
      ${header(round)}
      ${anchors(pair)}
      <form class="guess" autocomplete="off">
        <input name="word" aria-label="Your word" placeholder="one word in the middle" autocapitalize="none" spellcheck="false" maxlength="24" required>
        <button class="primary">Cut</button>
      </form>
      <p class="error" role="alert"></p>
    </section>`);
  const input = view.querySelector('input');
  const error = view.querySelector('.error');
  view.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const { word, problem } = check(pair, input.value);
    if (problem) return (error.textContent = problem);
    submit(pair, word);
  });
  input.addEventListener('input', () => (error.textContent = ''));
  app.replaceChildren(view);
  input.focus();
}

function splitBar(r) {
  const left = Math.round(r.share * 100);
  return `
    <div class="split" role="img" aria-label="${left} to ${100 - left}">
      <span class="sa" style="width:${Math.max(12, Math.min(88, r.share * 100))}%">${left}</span>
      <span class="sb">${100 - left}</span>
    </div>`;
}

const numbers = (r) => `
  <div class="numbers">
    <div><b>${pct(r.balance)}</b><span>Balance</span></div>
    <div><b>${pct(r.relevance)}</b><span>Relevance</span></div>
    <div class="total"><b>${fmt(r.total)}</b><span>Score</span></div>
  </div>`;

// Left-right is which anchor a word leans toward; up is how close it is to both.
function meaningMap(pair, you) {
  const W = 600, H = 260, L = 30, R = 570, T = 30, B = 220;
  // Zoomed to shares between 25:75 and 75:25, where nearly every sensible guess lands.
  const x = (r) => L + Math.max(0, Math.min(1, (0.75 - r.share) / 0.5)) * (R - L);
  const y = (r) => B - (Math.min(r.reach, 1.2) / 1.2) * (B - T);
  const picks = pair.picks
    .map((p, i) => `<circle class="pick" cx="${x(p)}" cy="${y(p)}" r="9"/><text class="pick-n" x="${x(p)}" y="${y(p) + 4}" text-anchor="middle">${i + 1}</text>`)
    .join('');
  const labelLeft = x(you) > W * 0.7;
  return `
    <svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of where your word and the best words sit between the anchors">
      <line class="axis" x1="${L}" y1="${B}" x2="${R}" y2="${B}"/>
      <line class="centre" x1="${W / 2}" y1="${T - 12}" x2="${W / 2}" y2="${B}"/>
      <text class="la" x="${L}" y="${B + 20}">← ${pair.a}</text>
      <text class="lb" x="${R}" y="${B + 20}" text-anchor="end">${pair.b} →</text>
      <text x="${W / 2}" y="${B + 20}" text-anchor="middle">perfectly balanced</text>
      <text x="${L}" y="${T - 12}">↑ closer to both</text>
      ${picks}
      <circle class="you" cx="${x(you)}" cy="${y(you)}" r="7"/>
      <text class="you-label" x="${x(you) + (labelLeft ? -12 : 12)}" y="${y(you) + 4}" text-anchor="${labelLeft ? 'end' : 'start'}">${you.word}</text>
    </svg>`;
}

function renderResult(pair, r) {
  const last = game.results.length === game.pairs.length;
  const rarity = RARITY.find(([limit]) => r.rank < limit)[1];
  const view = $(`
    <section class="card">
      ${header(game.results.length - 1)}
      ${anchors(pair)}
      <p class="yours">${r.word}</p>
      ${splitBar(r)}
      ${numbers(r)}
      <p class="rarity">${rarity} · #${(r.rank + 1).toLocaleString()} of ${words.length.toLocaleString()} words by how often it’s used</p>
      ${meaningMap(pair, r)}
      <ol class="picks" aria-label="Best words found">
        ${pair.picks.map((p, i) => `<li>${i + 1}. ${p.word} <b>${fmt(p.total)}</b></li>`).join('')}
      </ol>
      <div class="actions"><button class="primary" id="next"></button></div>
    </section>`);
  const next = view.querySelector('#next');
  if (game.mode === 'practice') {
    next.textContent = 'New pair';
    next.onclick = nextPracticePair;
  } else {
    next.textContent = last ? 'See results' : 'Next pair';
    next.onclick = last ? renderFinal : renderPrompt;
  }
  app.replaceChildren(view);
  next.focus();
}

function shareText() {
  const rows = game.results.map((r) => {
    const k = Math.max(0, Math.min(10, Math.round(r.share * 10)));
    return '🟦'.repeat(k) + '|' + '🟧'.repeat(10 - k);
  });
  return [`Fulcrum #${game.day}  ⚖️ ${fmt(dailyTotal())}`, ...rows].join('\n');
}

function renderFinal() {
  const s = stats(readStore());
  const now = new Date();
  const mins = Math.ceil((new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now) / 6e4);
  const rows = game.results
    .map((r, i) => {
      const [a, b] = game.pairs[i];
      return `<tr><td><span class="a">${a}</span> ↔ <span class="b">${b}</span></td><td>${r.word}</td><td>${fmt(r.total)}</td></tr>`;
    })
    .join('');
  const view = $(`
    <section class="card final">
      <div class="meta"><span>Fulcrum #${game.day}</span><span>Next puzzle in ${Math.floor(mins / 60)}h ${mins % 60}m</span></div>
      <p class="big">${fmt(dailyTotal())}</p>
      <pre class="share">${shareText()}</pre>
      <div class="actions">
        <button class="primary" id="copy">Copy result</button>
        <button id="practice">Keep playing</button>
      </div>
      <table class="rounds">${rows}</table>
      <div class="stats">
        <div><b>${s.played}</b><span>Played</span></div>
        <div><b>${s.streak}</b><span>Streak</span></div>
        <div><b>${fmt(s.average)}</b><span>Average</span></div>
        <div><b>${fmt(s.best)}</b><span>Best</span></div>
      </div>
    </section>`);
  const copy = view.querySelector('#copy');
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareText());
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select the text above to copy';
    }
  };
  view.querySelector('#practice').onclick = () => setMode('practice');
  app.replaceChildren(view);
}

// ---------- tutorial ----------

// A worked example on one pair, scored live so the numbers match the real game.
function renderTutorial(step = 0) {
  const pair = preparePair(['ocean', 'desert']);
  const example = (word, note) => {
    const r = pair.evaluate(word);
    return `
      <div class="example">
        <div class="example-head"><b>${word}</b><span>scores ${fmt(r.total)}</span></div>
        ${splitBar(r)}
        <p>${note}</p>
      </div>`;
  };
  const steps = [
    {
      title: 'Find the word in the middle',
      body: `
        <p>Each round gives you two words. Type <strong>one word whose meaning sits right between them</strong>.</p>
        <p>What is halfway between an ocean and a desert?</p>`,
    },
    {
      title: 'Balance: split it evenly',
      body: `
        <p>The bar shows how your word divides between the two. The dashed line is a perfect 50:50.</p>
        ${example('beach', 'Related to both, but it leans toward <span class="a">ocean</span>.')}
        ${example('sand', 'Almost dead centre: a beach has it and so does a desert.')}`,
    },
    {
      title: 'Relevance: stay close to both',
      body: `
        <p>A word can be perfectly balanced because it has nothing to do with either side. That doesn’t count.</p>
        ${example('banana', 'Evenly split, but far from both, so the score collapses.')}
        <p><strong>Score = balance × relevance</strong>, out of 100.</p>`,
    },
    {
      title: 'Your turn',
      body: `
        <p>Try a word of your own. This one is just for practice, so guess as many times as you like.</p>
        <form class="guess" autocomplete="off">
          <input name="word" aria-label="Your word" placeholder="one word in the middle" autocapitalize="none" spellcheck="false" maxlength="24" required>
          <button>Cut</button>
        </form>
        <p class="error" role="alert"></p>
        <div id="tryout"></div>
        <p class="fine">In the daily game you get five pairs and <strong>one guess each</strong>. They start friendly and get stranger. Everyone gets the same pairs.</p>`,
    },
  ];
  const last = step === steps.length - 1;
  const dots = steps.map((_, i) => `<i class="${i < step ? 'done' : i === step ? 'now' : ''}"></i>`).join('');
  const view = $(`
    <section class="card tutorial">
      <div class="meta"><span>How to play · ${step + 1} of ${steps.length}</span><span class="dots">${dots}</span></div>
      ${anchors(pair)}
      <h2>${steps[step].title}</h2>
      ${steps[step].body}
      <div class="actions">
        ${step > 0 ? '<button id="back">Back</button>' : '<button id="skip">Skip</button>'}
        <button class="primary" id="next">${last ? 'Play today’s puzzle' : 'Next'}</button>
      </div>
    </section>`);
  view.querySelector('#back')?.addEventListener('click', () => renderTutorial(step - 1));
  view.querySelector('#skip')?.addEventListener('click', () => setMode('daily'));
  view.querySelector('#next').onclick = () => (last ? setMode('daily') : renderTutorial(step + 1));

  const form = view.querySelector('form.guess');
  if (form) {
    const input = form.querySelector('input');
    const error = view.querySelector('.error');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const { word, problem } = check(pair, input.value);
      if (problem) return (error.textContent = problem);
      const r = pair.evaluate(word);
      const best = pair.picks[0];
      view.querySelector('#tryout').innerHTML = `
        <p class="yours">${r.word}</p>
        ${splitBar(r)}
        ${numbers(r)}
        <p class="rarity">The best word we found is <strong>${best.word}</strong> at ${fmt(best.total)}.</p>`;
      input.select();
    });
    input.addEventListener('input', () => (error.textContent = ''));
  }
  for (const id of ['mode-daily', 'mode-practice']) document.getElementById(id).setAttribute('aria-pressed', false);
  app.replaceChildren(view);
  (form?.querySelector('input') ?? view.querySelector('#next')).focus();
}

// ---------- shell ----------

function setMode(mode) {
  const store = readStore();
  if (!store.seenTutorial) writeStore({ ...store, seenTutorial: true });
  document.getElementById('mode-daily').setAttribute('aria-pressed', mode === 'daily');
  document.getElementById('mode-practice').setAttribute('aria-pressed', mode === 'practice');
  mode === 'daily' ? startDaily() : startPractice();
}

document.getElementById('mode-daily').onclick = () => setMode('daily');
document.getElementById('mode-practice').onclick = () => setMode('practice');
const help = document.getElementById('help');
document.getElementById('help-open').onclick = () => help.showModal();
help.addEventListener('close', () => {
  if (help.returnValue === 'tutorial') renderTutorial();
  help.returnValue = '';
});

try {
  await load();
  readStore().seenTutorial ? setMode('daily') : renderTutorial();
} catch (err) {
  console.error(err);
  app.replaceChildren($(`<p class="loading">Couldn’t load the game data. Run <code>npm run build:data</code> and serve the <code>public</code> folder over HTTP.</p>`));
}
