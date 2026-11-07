// UI: renders screens and forwards user input to the quiz logic in quiz.js.
import { MODES, createQuiz, loadLayer, loadRegions } from './quiz.js';

const NEXT_DELAY_MS = 600;

const $ = (id) => document.getElementById(id);
const els = {
  startScreen: $('start-screen'),
  startForm: $('start-form'),
  startError: $('start-error'),
  regionOptions: $('region-options'),
  layerOptions: $('layer-options'),
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
};

let regions = [];
let quiz = null;
let nextTimer = null;

// ---------- Start screen ----------

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

function renderLayerOptions(regionId) {
  const region = regions.find((r) => r.id === regionId);
  els.layerOptions.replaceChildren(
    ...region.layers.map((layer, i) => radio('layer', layer.id, layer.name, i === 0)),
  );
}

function renderStartScreen() {
  els.regionOptions.replaceChildren(
    ...regions.map((region, i) => radio('region', region.id, region.name, i === 0)),
  );
  renderLayerOptions(regions[0].id);
}

els.regionOptions.addEventListener('change', (e) => renderLayerOptions(e.target.value));

els.startForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(els.startForm);
  els.startError.hidden = true;
  try {
    await startQuiz(form.get('region'), form.get('layer'), form.get('mode'));
  } catch (err) {
    els.startError.textContent = err.message;
    els.startError.hidden = false;
  }
});

// ---------- Quiz screen ----------

async function startQuiz(regionId, layerId, mode) {
  const layer = await loadLayer(regionId, layerId);
  const svgRes = await fetch(layer.svgUrl);
  if (!svgRes.ok) throw new Error(`Could not load ${layer.svgUrl}`);
  els.svgHost.innerHTML = await svgRes.text();

  quiz = createQuiz(layer, { mode });

  const region = regions.find((r) => r.id === regionId);
  const layerName = region.layers.find((l) => l.id === layerId).name;
  els.quizTitle.textContent = `${region.name} · ${layerName} · ${mode === MODES.HINT ? 'Hint' : 'Recall'}`;
  els.answerButton.hidden = mode === MODES.HINT;

  els.startScreen.hidden = true;
  els.quizScreen.hidden = false;
  renderItem({ animate: false });
  els.answerInput.focus();
}

function stopQuiz() {
  clearTimeout(nextTimer);
  quiz = null;
  els.svgHost.replaceChildren();
  els.quizScreen.hidden = true;
  els.startScreen.hidden = false;
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

function goNext() {
  quiz.next();
  renderItem();
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
  if (quiz.isAnswered()) nextTimer = setTimeout(goNext, NEXT_DELAY_MS);
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

els.backButton.addEventListener('click', stopQuiz);
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
