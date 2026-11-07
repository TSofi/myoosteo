// Quiz logic. Pure JavaScript: no DOM access here, so it can be unit-tested
// and reused by any UI.

export const MODES = Object.freeze({ HINT: 'hint', RECALL: 'recall' });

/** Lower-case, trim and collapse inner whitespace. */
export function normalize(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Recall mode: the English or the Latin name counts as correct. */
export function isCorrectAnswer(item, input) {
  const answer = normalize(input);
  if (!answer) return false;
  return answer === normalize(item.name) || answer === normalize(item.latin);
}

/**
 * Throws if a layer file is malformed. Checks required fields, unique ids,
 * and that every `next` points to another existing item.
 */
export function validateLayer(data) {
  if (!data || !Array.isArray(data.items) || data.items.length < 2) {
    throw new Error('Layer must have an "items" array with at least 2 items');
  }
  const ids = new Set();
  for (const item of data.items) {
    for (const field of ['id', 'name', 'latin', 'svgId', 'next']) {
      if (typeof item[field] !== 'string' || !item[field]) {
        throw new Error(`Item ${item.id ?? '?'} is missing "${field}"`);
      }
    }
    if (ids.has(item.id)) throw new Error(`Duplicate item id "${item.id}"`);
    ids.add(item.id);
  }
  for (const item of data.items) {
    if (item.next === item.id) throw new Error(`Item "${item.id}" points to itself`);
    if (!ids.has(item.next)) throw new Error(`Item "${item.id}" has unknown next "${item.next}"`);
  }
  if (data.start && !ids.has(data.start)) {
    throw new Error(`Unknown start item "${data.start}"`);
  }
  return data;
}

async function fetchJson(url, fetchFn) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

/** Loads data/regions.json: the list of regions and their layers. */
export async function loadRegions({ baseUrl = 'data', fetchFn = globalThis.fetch } = {}) {
  const data = await fetchJson(`${baseUrl}/regions.json`, fetchFn);
  return data.regions;
}

/** Loads and validates data/<region>/<layer>.json. Adds `svgUrl`. */
export async function loadLayer(region, layer, { baseUrl = 'data', fetchFn = globalThis.fetch } = {}) {
  const data = validateLayer(await fetchJson(`${baseUrl}/${region}/${layer}.json`, fetchFn));
  return { ...data, svgUrl: `${baseUrl}/${region}/${data.svg}` };
}

/**
 * Creates a practice session for one layer in one mode.
 * The order follows each item's `next` field (anatomical neighbours).
 */
export function createQuiz(layerData, { mode = MODES.HINT, startId } = {}) {
  if (!Object.values(MODES).includes(mode)) throw new Error(`Unknown mode "${mode}"`);
  validateLayer(layerData);

  const byId = new Map(layerData.items.map((item) => [item.id, item]));
  let current = byId.get(startId ?? layerData.start ?? layerData.items[0].id);
  if (!current) throw new Error(`Unknown start item "${startId}"`);

  let typed = 0; // hint mode: number of correctly typed characters
  let answered = false; // the current item is finished
  const stats = { answered: 0, correct: 0, wrong: 0, mistakes: 0 };

  function finish(correct) {
    answered = true;
    stats.answered += 1;
    stats[correct ? 'correct' : 'wrong'] += 1;
  }

  return {
    mode,

    current: () => current,

    /** Hint mode: the name split into the typed and the remaining part. */
    hint() {
      return { done: current.name.slice(0, typed), rest: current.name.slice(typed) };
    },

    isAnswered: () => answered,

    /**
     * Hint mode: feeds one typed character. Only the next correct character
     * advances the hint; anything else is counted as a mistake.
     */
    typeChar(char) {
      if (mode !== MODES.HINT) throw new Error('typeChar is only for hint mode');
      if (answered) return { accepted: false, complete: true };
      const expected = current.name[typed];
      const accepted = typeof char === 'string' && char.length === 1
        && char.toLowerCase() === expected.toLowerCase();
      if (accepted) {
        typed += 1;
        if (typed === current.name.length) finish(true);
      } else {
        stats.mistakes += 1;
      }
      return { accepted, complete: answered };
    },

    /** Recall mode: checks a full answer. */
    submit(input) {
      if (mode !== MODES.RECALL) throw new Error('submit is only for recall mode');
      if (answered) throw new Error('Already answered, call next()');
      const correct = isCorrectAnswer(current, input);
      finish(correct);
      return { correct, expected: current.name };
    },

    /** Moves to the anatomical neighbour of the current item. */
    next() {
      current = byId.get(current.next);
      typed = 0;
      answered = false;
      return current;
    },

    /** Session counters. Not shown in the UI yet. */
    stats: () => ({ ...stats }),
  };
}
