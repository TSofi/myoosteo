import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MODES, ORDERS, normalize, isCorrectAnswer, validateLayer, loadLayer, loadRegions, createQuiz,
  shuffle, buildOrder, updateMistakes, mistakeIds,
} from '../src/quiz.js';

// Vitest runs from the project root.
const fromRoot = (path) => resolve(process.cwd(), path);

// fetch replacement that reads files from the project folder.
const fileFetch = async (url) => {
  try {
    const text = await readFile(fromRoot(url), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, status: 404 };
  }
};

const sample = () => ({
  region: 'test',
  layer: 'bones',
  svg: 'bones.svg',
  start: 'a',
  items: [
    { id: 'a', name: 'Scaphoid', latin: 'Os scaphoideum', svgId: 'sa', next: 'b' },
    { id: 'b', name: 'First  metacarpal', latin: 'Os metacarpi I', svgId: 'sb', next: 'c' },
    { id: 'c', name: 'Lunate', latin: 'Os lunatum', svgId: 'sc', next: 'a' },
  ],
});

// Deterministic stand-in for Math.random (small linear congruential generator).
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function typeWord(quiz, word) {
  return [...word].map((ch) => quiz.typeChar(ch));
}

describe('answer checking', () => {
  it('normalizes case and whitespace', () => {
    expect(normalize('  First   METACARPAL ')).toBe('first metacarpal');
  });

  it('accepts English or Latin name, case-insensitive, ignoring extra spaces', () => {
    const item = sample().items[1];
    expect(isCorrectAnswer(item, 'first metacarpal')).toBe(true);
    expect(isCorrectAnswer(item, '  FIRST   Metacarpal  ')).toBe(true);
    expect(isCorrectAnswer(item, 'os metacarpi i')).toBe(true);
    expect(isCorrectAnswer(item, 'second metacarpal')).toBe(false);
    expect(isCorrectAnswer(item, '')).toBe(false);
  });
});

describe('hint mode', () => {
  it('advances only on the next correct letter, case-insensitive', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    expect(quiz.typeChar('s')).toEqual({ accepted: true, complete: false });
    expect(quiz.typeChar('x')).toEqual({ accepted: false, complete: false });
    expect(quiz.typeChar('C')).toEqual({ accepted: true, complete: false });
    expect(quiz.hint()).toEqual({ done: 'Sc', rest: 'aphoid' });
  });

  it('completes when the whole name is typed', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    const results = typeWord(quiz, 'scaphoid');
    expect(results.at(-1)).toEqual({ accepted: true, complete: true });
    expect(quiz.isAnswered()).toBe(true);
    expect(quiz.hint()).toEqual({ done: 'Scaphoid', rest: '' });
  });

  it('ignores typing after completion', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    typeWord(quiz, 'scaphoid');
    expect(quiz.typeChar('x')).toEqual({ accepted: false, complete: true });
    expect(quiz.stats().mistakes).toBe(0);
  });

  it('cannot be used with submit()', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    expect(() => quiz.submit('Scaphoid')).toThrow();
  });
});

describe('recall mode', () => {
  it('marks correct and wrong answers and returns the expected name', () => {
    const quiz = createQuiz(sample(), { mode: MODES.RECALL });
    expect(quiz.submit(' SCAPHOID ')).toEqual({ correct: true, expected: 'Scaphoid' });
    quiz.next();
    expect(quiz.submit('lunate')).toEqual({ correct: false, expected: 'First  metacarpal' });
  });

  it('refuses a second answer for the same item', () => {
    const quiz = createQuiz(sample(), { mode: MODES.RECALL });
    quiz.submit('x');
    expect(() => quiz.submit('Scaphoid')).toThrow();
  });

  it('cannot be used with typeChar()', () => {
    const quiz = createQuiz(sample(), { mode: MODES.RECALL });
    expect(() => quiz.typeChar('s')).toThrow();
  });
});

describe('scoring (session counters)', () => {
  it('counts correct and wrong answers in recall mode', () => {
    const quiz = createQuiz(sample(), { mode: MODES.RECALL });
    quiz.submit('Scaphoid');
    quiz.next();
    quiz.submit('wrong');
    quiz.next();
    quiz.submit('os lunatum');
    expect(quiz.stats()).toEqual({ answered: 3, correct: 2, wrong: 1, mistakes: 0 });
  });

  it('counts wrong keystrokes as mistakes in hint mode, so the item is not correct first try', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    typeWord(quiz, 'sxcaphoid');
    expect(quiz.stats()).toEqual({ answered: 1, correct: 0, wrong: 1, mistakes: 1 });
    expect(quiz.lastResult()).toEqual({ id: 'a', correct: false });
  });

  it('counts a hint item typed without mistakes as correct first try', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    expect(quiz.lastResult()).toBeNull();
    typeWord(quiz, 'scaphoid');
    expect(quiz.lastResult()).toEqual({ id: 'a', correct: true });
    quiz.next();
    typeWord(quiz, 'first  metacarpal');
    expect(quiz.stats().correct).toBe(2);
  });

  it('returns a copy so callers cannot change the counters', () => {
    const quiz = createQuiz(sample(), { mode: MODES.RECALL });
    quiz.stats().correct = 99;
    expect(quiz.stats().correct).toBe(0);
  });
});

describe('order', () => {
  it('follows the next field and resets progress', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    expect(quiz.current().id).toBe('a');
    typeWord(quiz, 'scaph');
    expect(quiz.next().id).toBe('b');
    expect(quiz.hint().done).toBe('');
    expect(quiz.isAnswered()).toBe(false);
    expect(quiz.next().id).toBe('c');
  });

  it('asks every item once, then finishes', () => {
    const quiz = createQuiz(sample(), { mode: MODES.RECALL });
    expect(quiz.total()).toBe(3);
    quiz.next();
    quiz.next();
    expect(quiz.isFinished()).toBe(false);
    expect(quiz.next()).toBeNull();
    expect(quiz.isFinished()).toBe(true);
    expect(quiz.current()).toBeNull();
    expect(() => quiz.submit('x')).toThrow(/finished/);
  });

  it('never repeats the same question twice in a row, also across random sessions', () => {
    const random = seeded(7);
    let prev = null;
    for (let session = 0; session < 30; session += 1) {
      const quiz = createQuiz(sample(), {
        mode: MODES.RECALL, order: ORDERS.RANDOM, avoidFirstId: prev, random,
      });
      for (let item = quiz.current(); item; item = quiz.next()) {
        expect(item.id).not.toBe(prev);
        prev = item.id;
      }
    }
  });

  it('rejects data where an item points to itself', () => {
    const data = sample();
    data.items[0].next = 'a';
    expect(() => createQuiz(data)).toThrow(/points to itself/);
  });

  it('can start at a chosen item', () => {
    expect(createQuiz(sample(), { startId: 'c' }).current().id).toBe('c');
  });
});

describe('validateLayer', () => {
  it('rejects unknown next, duplicate ids, missing fields and bad start', () => {
    const unknown = sample(); unknown.items[2].next = 'zzz';
    expect(() => validateLayer(unknown)).toThrow(/unknown next/);
    const dup = sample(); dup.items[1].id = 'a';
    expect(() => validateLayer(dup)).toThrow(/Duplicate/);
    const missing = sample(); delete missing.items[0].latin;
    expect(() => validateLayer(missing)).toThrow(/latin/);
    const start = sample(); start.start = 'nope';
    expect(() => validateLayer(start)).toThrow(/start/);
    expect(() => validateLayer({ items: [] })).toThrow();
  });
});

describe('loading a layer', () => {
  it('fetches data/<region>/<layer>.json and resolves the SVG url', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, status: 200, json: async () => sample() }));
    const layer = await loadLayer('test', 'bones', { baseUrl: 'data', fetchFn });
    expect(fetchFn).toHaveBeenCalledWith('data/test/bones.json');
    expect(layer.svgUrl).toBe('data/test/bones.svg');
    expect(layer.items).toHaveLength(3);
  });

  it('throws on a missing file', async () => {
    const fetchFn = async () => ({ ok: false, status: 404 });
    await expect(loadLayer('nope', 'bones', { fetchFn })).rejects.toThrow(/404/);
  });

  it('loads every layer listed in regions.json, and each order visits all items', async () => {
    const regions = await loadRegions({ fetchFn: fileFetch });
    expect(regions.map((r) => r.id)).toContain('hand');

    for (const region of regions) {
      for (const { id: layerId } of region.layers) {
        const layer = await loadLayer(region.id, layerId, { fetchFn: fileFetch });
        const quiz = createQuiz(layer);
        const seen = new Set([quiz.current().id]);
        for (let i = 1; i < layer.items.length; i += 1) seen.add(quiz.next().id);
        expect(seen.size, `${region.id}/${layerId} order skips items`).toBe(layer.items.length);

        const svg = await readFile(fromRoot(layer.svgUrl), 'utf8');
        for (const item of layer.items) {
          expect(svg, `${layer.svgUrl} lacks #${item.svgId}`).toContain(`id="${item.svgId}"`);
        }
      }
    }
  });
});

describe('separation from the UI', () => {
  it('quiz.js does not touch the DOM', async () => {
    const source = await readFile(fromRoot('src/quiz.js'), 'utf8');
    expect(source).not.toMatch(/\b(document|window)\b/);
  });
});

describe('shuffle', () => {
  it('returns a new array with the same items', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    const result = shuffle(list, seeded(1));
    expect(result).not.toBe(list);
    expect([...result].sort()).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('is deterministic for the same random source', () => {
    const list = Array.from({ length: 10 }, (_, i) => i);
    expect(shuffle(list, seeded(3))).toEqual(shuffle(list, seeded(3)));
  });

  it('actually changes the order for some seed', () => {
    const list = Array.from({ length: 10 }, (_, i) => i);
    const changed = [1, 2, 3, 4, 5].some((s) => shuffle(list, seeded(s)).join() !== list.join());
    expect(changed).toBe(true);
  });
});

describe('buildOrder', () => {
  it('follows neighbours from the start item', () => {
    expect(buildOrder(sample())).toEqual(['a', 'b', 'c']);
    expect(buildOrder(sample(), { startId: 'b' })).toEqual(['b', 'c', 'a']);
  });

  it('appends items the neighbour chain does not reach', () => {
    const data = sample();
    data.items.push({ id: 'd', name: 'Hamate', latin: 'Os hamatum', svgId: 'sd', next: 'a' });
    expect(buildOrder(data)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('random order contains every item once', () => {
    const ids = buildOrder(sample(), { order: ORDERS.RANDOM, random: seeded(5) });
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps only the requested items, in order', () => {
    expect(buildOrder(sample(), { onlyIds: ['c', 'a'] })).toEqual(['a', 'c']);
    expect(buildOrder(sample(), { onlyIds: [] })).toEqual([]);
  });

  it('does not start with avoidFirstId when there is another choice', () => {
    expect(buildOrder(sample(), { avoidFirstId: 'a' })).toEqual(['b', 'a', 'c']);
    expect(buildOrder(sample(), { onlyIds: ['a'], avoidFirstId: 'a' })).toEqual(['a']);
  });

  it('rejects an unknown order', () => {
    expect(() => buildOrder(sample(), { order: 'sideways' })).toThrow(/Unknown order/);
  });

  it('createQuiz refuses an empty selection', () => {
    expect(() => createQuiz(sample(), { onlyIds: [] })).toThrow(/No structures/);
  });
});

describe('mistake counting', () => {
  it('adds one per wrong answer without changing the input', () => {
    const start = { a: 1 };
    const after = updateMistakes(updateMistakes(start, 'a', false), 'b', false);
    expect(after).toEqual({ a: 2, b: 1 });
    expect(start).toEqual({ a: 1 });
  });

  it('keeps the count on a correct answer unless resetOnCorrect is set', () => {
    expect(updateMistakes({ a: 2 }, 'a', true)).toEqual({ a: 2 });
    expect(updateMistakes({ a: 2, b: 1 }, 'a', true, { resetOnCorrect: true })).toEqual({ b: 1 });
  });

  it('lists ids with mistakes, most mistakes first', () => {
    expect(mistakeIds({ a: 1, b: 3, c: 0 })).toEqual(['b', 'a']);
    expect(mistakeIds(undefined)).toEqual([]);
  });

  it('a repeat-my-mistakes session asks only those items', () => {
    const ids = mistakeIds({ c: 2, a: 1 });
    const quiz = createQuiz(sample(), { mode: MODES.RECALL, onlyIds: ids });
    expect(quiz.total()).toBe(2);
    expect(quiz.current().id).toBe('a');
    expect(quiz.next().id).toBe('c');
  });
});

describe('summary', () => {
  it('reports first-try correct answers and the items with mistakes', () => {
    const quiz = createQuiz(sample(), { mode: MODES.RECALL });
    quiz.submit('scaphoid');
    quiz.next();
    quiz.submit('nope');
    quiz.next();
    quiz.submit('lunate');
    quiz.next();
    expect(quiz.summary()).toEqual({
      total: 3,
      answered: 3,
      correctFirstTry: 2,
      mistakes: [{ id: 'b', name: 'First  metacarpal', latin: 'Os metacarpi I' }],
    });
  });

  it('counts only finished items when the session is left early', () => {
    const quiz = createQuiz(sample(), { mode: MODES.HINT });
    typeWord(quiz, 'scaphxoid');
    quiz.next();
    typeWord(quiz, 'fir');
    const summary = quiz.summary();
    expect(summary.answered).toBe(1);
    expect(summary.correctFirstTry).toBe(0);
    expect(summary.mistakes.map((m) => m.id)).toEqual(['a']);
  });
});
