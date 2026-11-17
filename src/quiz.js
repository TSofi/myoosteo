// Quiz logic. Pure JavaScript: no DOM access here, so it can be unit-tested
// and reused by any UI.

export const MODES = Object.freeze({ HINT: 'hint', RECALL: 'recall' });
export const ORDERS = Object.freeze({ NEIGHBOURS: 'neighbours', RANDOM: 'random' });

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

/** Returns a shuffled copy (Fisher-Yates). `random` returns a number in [0, 1). */
export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Builds the list of item ids for one session; every item appears once.
 * - neighbours: follow `next` from the start item; items the chain never
 *   reaches are appended at the end.
 * - random: shuffled.
 * `onlyIds` keeps just those items (in the same order). `avoidFirstId` makes
 * sure a new session does not start with the item the last one ended on.
 */
export function buildOrder(layerData, {
  order = ORDERS.NEIGHBOURS, startId, onlyIds, avoidFirstId, random = Math.random,
} = {}) {
  if (!Object.values(ORDERS).includes(order)) throw new Error(`Unknown order "${order}"`);
  const byId = new Map(layerData.items.map((item) => [item.id, item]));
  let ids;
  if (order === ORDERS.RANDOM) {
    ids = shuffle(layerData.items.map((item) => item.id), random);
  } else {
    const first = startId ?? layerData.start ?? layerData.items[0].id;
    if (!byId.has(first)) throw new Error(`Unknown start item "${first}"`);
    ids = [];
    const seen = new Set();
    for (let id = first; id && !seen.has(id); id = byId.get(id).next) {
      seen.add(id);
      ids.push(id);
    }
    for (const item of layerData.items) if (!seen.has(item.id)) ids.push(item.id);
  }
  if (onlyIds) {
    const keep = new Set(onlyIds);
    ids = ids.filter((id) => keep.has(id));
  }
  if (ids.length > 1 && ids[0] === avoidFirstId) {
    [ids[0], ids[1]] = [ids[1], ids[0]];
  }
  return ids;
}

/**
 * Mistake counts are a plain object { itemId: number }, so the UI can store
 * them as JSON. Returns a new object; the input is not changed.
 * A wrong answer adds 1. With `resetOnCorrect`, a correct first-try answer
 * clears that item (used when repeating mistakes).
 */
export function updateMistakes(counts, id, correct, { resetOnCorrect = false } = {}) {
  const next = { ...counts };
  if (!correct) next[id] = (next[id] ?? 0) + 1;
  else if (resetOnCorrect) delete next[id];
  return next;
}

/** Ids with at least one mistake, most mistakes first. */
export function mistakeIds(counts) {
  return Object.entries(counts ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/**
 * Creates a practice session for one layer: every selected item is asked
 * once, in the order from buildOrder(). next() returns null at the end.
 */
export function createQuiz(layerData, {
  mode = MODES.HINT, order, startId, onlyIds, avoidFirstId, random,
} = {}) {
  if (!Object.values(MODES).includes(mode)) throw new Error(`Unknown mode "${mode}"`);
  validateLayer(layerData);

  const byId = new Map(layerData.items.map((item) => [item.id, item]));
  if (startId && !byId.has(startId)) throw new Error(`Unknown start item "${startId}"`);
  const queue = buildOrder(layerData, { order, startId, onlyIds, avoidFirstId, random });
  if (queue.length === 0) throw new Error('No structures to ask');

  let index = 0;
  let current = byId.get(queue[0]);
  let typed = 0; // hint mode: number of correctly typed characters
  let itemMistakes = 0; // hint mode: wrong keystrokes on the current item
  let answered = false; // the current item is finished
  const stats = { answered: 0, correct: 0, wrong: 0, mistakes: 0 };
  const results = []; // { id, correct } per finished item, correct = first try

  function finish(correct) {
    answered = true;
    stats.answered += 1;
    stats[correct ? 'correct' : 'wrong'] += 1;
    results.push({ id: current.id, correct });
  }

  return {
    mode,

    /** The current item, or null when the session is finished. */
    current: () => current,

    /** Number of items in this session. */
    total: () => queue.length,

    isFinished: () => current === null,

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
      if (answered || !current) return { accepted: false, complete: true };
      const expected = current.name[typed];
      const accepted = typeof char === 'string' && char.length === 1
        && char.toLowerCase() === expected.toLowerCase();
      if (accepted) {
        typed += 1;
        if (typed === current.name.length) finish(itemMistakes === 0);
      } else {
        stats.mistakes += 1;
        itemMistakes += 1;
      }
      return { accepted, complete: answered };
    },

    /** Recall mode: checks a full answer. */
    submit(input) {
      if (mode !== MODES.RECALL) throw new Error('submit is only for recall mode');
      if (!current) throw new Error('Session is finished');
      if (answered) throw new Error('Already answered, call next()');
      const correct = isCorrectAnswer(current, input);
      finish(correct);
      return { correct, expected: current.name };
    },

    /** Moves to the next item in the order; returns null after the last one. */
    next() {
      index += 1;
      current = index < queue.length ? byId.get(queue[index]) : null;
      typed = 0;
      itemMistakes = 0;
      answered = false;
      return current;
    },

    /** Result of the last finished item: { id, correct }, or null. */
    lastResult: () => (results.length ? { ...results.at(-1) } : null),

    /** Session counters (mistakes = wrong keystrokes in hint mode). */
    stats: () => ({ ...stats }),

    /**
     * End-of-session summary: how many finished items were correct on the
     * first try, and the items that had a mistake, in the order asked.
     */
    summary() {
      const wrong = results.filter((r) => !r.correct).map((r) => byId.get(r.id));
      return {
        total: queue.length,
        answered: results.length,
        correctFirstTry: results.length - wrong.length,
        mistakes: wrong.map(({ id, name, latin }) => ({ id, name, latin })),
      };
    },
  };
}
