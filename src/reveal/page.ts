import type { RevealKind, RevealResponse } from '../../shared/schema';
import { ApiError, fetchReveal, markOpened } from '../api';
import { button, h } from '../dom';
import { REVEAL_FACTORIES } from './registry';
import { createSfx } from './sfx';
import { createStage } from './stage';

export type RevealSource =
  { type: 'token'; token: string } | { type: 'preview'; reveal: RevealKind };

const CARD_DELAY_MS = 380;
const LETTER_STAGGER_MS = 55;

function previewData(reveal: RevealKind): RevealResponse {
  return { title: 'Preview', note: '', giverName: 'Preview', receiverName: 'Sample Name', reveal };
}

function renderName(name: string): HTMLElement {
  const heading = h('h2', { class: 'card__name', 'aria-label': name });
  const longestWord = Math.max(4, ...name.split(/\s+/).map((word) => word.length));
  heading.style.setProperty('--longest-word', String(longestWord));
  let index = 0;
  for (const word of name.split(/\s+/)) {
    const wordElement = h('span', { class: 'card__word', 'aria-hidden': 'true' });
    for (const letter of word) {
      const letterElement = h('span', { class: 'card__letter' }, letter);
      letterElement.style.animationDelay = `${index * LETTER_STAGGER_MS}ms`;
      wordElement.append(letterElement);
      index += 1;
    }
    heading.append(wordElement, ' ');
  }
  return heading;
}

function renderMessage(root: HTMLElement, text: string): void {
  root.replaceChildren(h('main', { class: 'reveal reveal--message' }, h('p', {}, text)));
}

function start(root: HTMLElement, source: RevealSource, data: RevealResponse): void {
  const sfx = createSfx();
  const canvas = h('canvas', { class: 'reveal__canvas' });
  const hint = h('p', { class: 'reveal__hint', 'aria-live': 'polite' });
  const progressBar = h('div', { class: 'progress__bar' });
  const card = h(
    'section',
    { class: 'card', hidden: '' },
    h('div', { class: 'card__rays', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'card__panel' },
      h('p', { class: 'card__label' }, `${data.giverName}, you're buying for`),
      renderName(data.receiverName),
      h('div', { class: 'card__rule', 'aria-hidden': 'true' }),
    ),
  );
  if (data.note) card.lastElementChild?.append(h('p', { class: 'card__note' }, data.note));

  let muted = false;
  const sound = button('Sound on', 'reveal__sound', () => {
    muted = !muted;
    sfx.setMuted(muted);
    sound.textContent = muted ? 'Sound off' : 'Sound on';
  });

  const page = h(
    'main',
    { class: 'reveal' },
    canvas,
    h(
      'header',
      { class: 'reveal__header' },
      h('p', { class: 'reveal__title' }, data.title || 'Kris Kringle'),
      h('h1', {}, `Hi ${data.giverName}`),
    ),
    sound,
    h('footer', { class: 'reveal__footer' }, hint, h('div', { class: 'progress' }, progressBar)),
    card,
  );
  root.replaceChildren(page);

  createStage({
    canvas,
    receiverName: data.receiverName,
    factory: REVEAL_FACTORIES[data.reveal],
    sfx,
    onHint(text) {
      hint.textContent = text;
    },
    onProgress(value) {
      progressBar.style.transform = `scaleX(${value})`;
    },
    onComplete() {
      page.classList.add('is-complete');
      window.setTimeout(() => {
        card.hidden = false;
      }, CARD_DELAY_MS);
      if (source.type === 'token') {
        // Only affects the admin's "opened" column, so a failure here is safe to ignore.
        markOpened(source.token).catch(() => undefined);
      }
    },
  });
}

export function mountReveal(root: HTMLElement, source: RevealSource): void {
  document.body.className = 'reveal-body';

  if (source.type === 'preview') {
    start(root, source, previewData(source.reveal));
    return;
  }

  renderMessage(root, 'Loading');
  fetchReveal(source.token).then(
    (data) => start(root, source, data),
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        renderMessage(root, 'Names have not been drawn yet. Try this link again later.');
      } else if (error instanceof ApiError && error.status === 404) {
        renderMessage(root, 'This link is not valid. Ask the organiser for a new one.');
      } else {
        renderMessage(root, 'Could not load. Check your connection and reload.');
      }
    },
  );
}
