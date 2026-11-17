// UI: renders screens and forwards user input to the quiz logic in quiz.js.
import {
  MODES, ORDERS, createQuiz, loadLayer, loadRegions, mistakeIds, updateMistakes,
} from './quiz.js';

const NEXT_DELAY_MS = 600;
const SETTINGS_KEY = 'myoosteo:settings';
const MISTAKES_KEY = 'myoosteo:mistakes';

const $ = (id) => document.getElementById(id);
const els = {
  startScreen: $('start-screen'),
  startForm: $('start-form'),
  startError: $('start-error'),
  regionOptions: $('region-options'),
  layerOptions: $('layer-options'),
  setMistakes: $('set-mistakes'),
  mistakesCount: $('mistakes-count'),
  quizScreen: $('quiz-screen'),
  quizTitle: $('quiz-title'),
  backButton: $('back-button'),
  stage: $('stage'),
  svgHost: $('svg-host'),
  highlight: $('highlight'),
  hint: $('hint'),
  hintLatin: $('hint-latin'),
  answerForm: $('answer-form'),
  answerInput: $('answer-input'),
  answerButton: $('answer-button'),
  feedback: $('feedback'),
  summaryScreen: $('summary-screen'),
  summaryTitle: $('summary-title'),
  summaryScore: $('summary-score'),
  summaryMistakes: $('summary-mistakes'),
  summaryNone: $('summary-none'),
  againButton: $('again-button'),
  repeatButton: $('repeat-button'),
  menuButton: $('menu-button'),
  announcer: $('announcer'),
};

let regions = [];
let quiz = null;
let session = null; // { region, layer, mode, order, onlyMistakes, layerData, lastId }
let nextTimer = null;

// ---------- Storage (localStorage may be missing or blocked) ----------

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not saved; the app still works for this visit.
  }
}

const layerKey = (region, layer) => `${region}/${layer}`;

function storedMistakes(region, layer) {
  return readJson(MISTAKES_KEY, {})[layerKey(region, layer)] ?? {};
}

function saveMistakes(region, layer, counts) {
  const all = readJson(MISTAKES_KEY, {});
  all[layerKey(region, layer)] = counts;
  writeJson(MISTAKES_KEY, all);
}

// ---------- Screens ----------

function showScreen(screen) {
  for (const el of [els.startScreen, els.quizScreen, els.summaryScreen]) el.hidden = el !== screen;
}

function announce(text) {
  els.announcer.textContent = text;
}

// ---------- Settings screen ----------

function radio(name, value, label, checked) {
  const wrap = document.createElement('label');
  wrap.className = 'option';
  const input = document.createElement('input');
  Object.assign(input, { type: 'radio', name, value, checked });
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  return wrap;
}

function checkRadio(name, value) {
  const input = els.startForm.querySelector(`input[name="${name}"][value="${CSS.escape(value ?? '')}"]`);
  if (input) input.checked = true;
}

function selected(name) {
  return new FormData(els.startForm).get(name);
}

function renderLayerOptions(regionId, layerId) {
  const region = regions.find((r) => r.id === regionId);
  const current = region.layers.some((l) => l.id === layerId) ? layerId : region.layers[0].id;
  els.layerOptions.replaceChildren(
    ...region.layers.map((layer) => radio('layer', layer.id, layer.name, layer.id === current)),
  );
  renderMistakesOption();
}

/** Shows how many saved mistakes the chosen layer has; disables the option at 0. */
function renderMistakesOption() {
  const count = mistakeIds(storedMistakes(selected('region'), selected('layer'))).length;
  els.setMistakes.disabled = count === 0;
  if (count === 0) checkRadio('set', 'all');
  els.mistakesCount.textContent = count === 0
    ? 'No mistakes saved yet'
    : `${count} structure${count === 1 ? '' : 's'} with mistakes`;
}

function renderStartScreen() {
  const saved = readJson(SETTINGS_KEY, {});
  const region = regions.some((r) => r.id === saved.region) ? saved.region : regions[0].id;
  els.regionOptions.replaceChildren(
    ...regions.map((r) => radio('region', r.id, r.name, r.id === region)),
  );
  renderLayerOptions(region, saved.layer);
  if (Object.values(MODES).includes(saved.mode)) checkRadio('mode', saved.mode);
  if (Object.values(ORDERS).includes(saved.order)) checkRadio('order', saved.order);
}

els.regionOptions.addEventListener('change', (e) => renderLayerOptions(e.target.value));
els.layerOptions.addEventListener('change', renderMistakesOption);

els.startForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const settings = {
    region: selected('region'),
    layer: selected('layer'),
    mode: selected('mode'),
    order: selected('order'),
  };
  writeJson(SETTINGS_KEY, settings);
  els.startError.hidden = true;
  try {
    await startSession({ ...settings, onlyMistakes: selected('set') === 'mistakes' });
  } catch (err) {
    els.startError.textContent = err.message;
    els.startError.hidden = false;
  }
});

function showMenu() {
  clearTimeout(nextTimer);
  quiz = null;
  els.svgHost.replaceChildren();
  renderMistakesOption();
  showScreen(els.startScreen);
  els.startForm.querySelector('button[type="submit"]').focus();
}

// ---------- Quiz screen ----------

async function startSession(settings) {
  const sameLayer = session && session.region === settings.region && session.layer === settings.layer;
  const layerData = sameLayer ? session.layerData : await loadLayer(settings.region, settings.layer);
  if (!sameLayer || !els.svgHost.firstChild) {
    const svgRes = await fetch(layerData.svgUrl);
    if (!svgRes.ok) throw new Error(`Could not load ${layerData.svgUrl}`);
    els.svgHost.innerHTML = await svgRes.text();
  }

  const onlyIds = settings.onlyMistakes
    ? mistakeIds(storedMistakes(settings.region, settings.layer))
    : undefined;
  quiz = createQuiz(layerData, {
    mode: settings.mode,
    order: settings.order,
    onlyIds,
    avoidFirstId: sameLayer ? session.lastId : undefined,
  });
  session = { ...settings, layerData, lastId: null };

  const region = regions.find((r) => r.id === settings.region);
  const layerName = region.layers.find((l) => l.id === settings.layer).name;
  const parts = [region.name, layerName, settings.mode === MODES.HINT ? 'Hint' : 'Recall'];
  if (settings.onlyMistakes) parts.push('Mistakes');
  els.quizTitle.textContent = parts.join(' · ');
  els.answerButton.hidden = settings.mode === MODES.HINT;

  showScreen(els.quizScreen);
  renderItem({ animate: false });
  els.answerInput.focus();
}

function activeElement() {
  return els.svgHost.querySelector(`#${CSS.escape(quiz.current().svgId)}`);
}

function renderItem({ animate = true } = {}) {
  els.svgHost.querySelectorAll('.is-active').forEach((el) => el.classList.remove('is-active'));
  const target = activeElement();
  if (target) target.classList.add('is-active');

  els.answerInput.value = '';
  els.answerButton.textContent = 'Check';
  setFeedback('');
  renderHint();
  positionOverlay(animate);
  // Recall mode must not say the name: that is the answer.
  announce(quiz.mode === MODES.HINT
    ? `Highlighted: ${quiz.current().name}. Type the name.`
    : 'Next structure highlighted. Type its name.');
}

function renderHint() {
  const showHint = quiz.mode === MODES.HINT;
  els.hint.hidden = !showHint;
  els.hintLatin.textContent = showHint ? quiz.current().latin : '';
  if (!showHint) return;
  const { done, rest } = quiz.hint();
  const doneSpan = document.createElement('span');
  doneSpan.className = 'done';
  doneSpan.textContent = done;
  const restSpan = document.createElement('span');
  restSpan.className = 'rest';
  restSpan.textContent = rest;
  els.hint.replaceChildren(doneSpan, restSpan);
}

/** Places the highlight box around the active structure. */
function positionOverlay(animate) {
  const target = activeElement();
  if (!target) return;
  const pad = 6;
  const stageBox = els.stage.getBoundingClientRect();
  const box = target.getBoundingClientRect();
  const left = box.left - stageBox.left - pad;
  const top = box.top - stageBox.top - pad;

  els.highlight.style.transition = animate ? '' : 'none';
  Object.assign(els.highlight.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${box.width + pad * 2}px`,
    height: `${box.height + pad * 2}px`,
  });

  if (!animate) {
    // Force layout so the next change animates again.
    void els.highlight.offsetWidth;
    els.highlight.style.transition = '';
  }
}

function setFeedback(text, kind = '') {
  els.feedback.className = `feedback ${kind}`.trim();
  els.feedback.textContent = text;
}

/** Saves the result of the item that was just finished. */
function recordResult() {
  const { id, correct } = quiz.lastResult();
  const counts = storedMistakes(session.region, session.layer);
  saveMistakes(session.region, session.layer, updateMistakes(counts, id, correct, {
    resetOnCorrect: session.onlyMistakes,
  }));
  session.lastId = id;
}

function goNext() {
  if (quiz.next()) renderItem();
  else showSummary();
}

// Hint mode: every typed character goes straight to the quiz logic.
els.answerInput.addEventListener('beforeinput', (e) => {
  if (!quiz || quiz.mode !== MODES.HINT) return;
  e.preventDefault();
  if (!e.data || quiz.isAnswered()) return;
  for (const char of e.data) {
    const { complete } = quiz.typeChar(char);
    if (complete) break;
  }
  els.answerInput.value = quiz.hint().done;
  renderHint();
  if (quiz.isAnswered()) {
    recordResult();
    nextTimer = setTimeout(goNext, NEXT_DELAY_MS);
  }
});

// Recall mode: Enter checks the answer; after a wrong answer, Enter moves on.
els.answerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!quiz || quiz.mode !== MODES.RECALL) return;
  if (quiz.isAnswered()) {
    clearTimeout(nextTimer);
    goNext();
    return;
  }
  const { correct, expected } = quiz.submit(els.answerInput.value);
  recordResult();
  if (correct) {
    setFeedback('Correct', 'ok');
    nextTimer = setTimeout(goNext, NEXT_DELAY_MS);
  } else {
    const item = quiz.current();
    els.feedback.className = 'feedback bad';
    els.feedback.replaceChildren(`Correct answer: ${expected} `, Object.assign(
      document.createElement('small'), { textContent: `(${item.latin}) — press Enter to continue` },
    ));
    els.answerButton.textContent = 'Next';
  }
});

// ---------- Summary screen ----------

function showSummary() {
  const { total, correctFirstTry, mistakes } = quiz.summary();
  quiz = null;
  els.summaryScore.textContent = `${correctFirstTry} of ${total} correct on the first try.`;
  els.summaryMistakes.replaceChildren(...mistakes.map((item) => {
    const li = document.createElement('li');
    const latin = Object.assign(document.createElement('span'), {
      className: 'latin', textContent: item.latin,
    });
    li.append(`${item.name} `, latin);
    return li;
  }));
  els.summaryMistakes.hidden = mistakes.length === 0;
  els.summaryNone.hidden = mistakes.length > 0;
  els.repeatButton.disabled = mistakeIds(storedMistakes(session.region, session.layer)).length === 0;

  showScreen(els.summaryScreen);
  els.summaryTitle.focus();
  announce(`Session finished. ${els.summaryScore.textContent}`);
}

function restart(onlyMistakes) {
  startSession({ ...session, onlyMistakes }).catch((err) => {
    showMenu();
    els.startError.textContent = err.message;
    els.startError.hidden = false;
  });
}

els.againButton.addEventListener('click', () => restart(session.onlyMistakes));
els.repeatButton.addEventListener('click', () => restart(true));
els.menuButton.addEventListener('click', showMenu);
els.backButton.addEventListener('click', showMenu);

// Esc returns to the settings menu from the quiz or the summary.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.startScreen.hidden) {
    e.preventDefault();
    showMenu();
  }
});

window.addEventListener('resize', () => quiz && positionOverlay(false));

// ---------- Boot ----------

loadRegions()
  .then((list) => {
    regions = list;
    renderStartScreen();
  })
  .catch((err) => {
    els.startError.textContent = `${err.message}. Run "npm start" and open the page through the local server.`;
    els.startError.hidden = false;
  });
