import {
  REVEAL_KINDS,
  REVEAL_LABELS,
  type RevealKind,
  type RevealResponse,
} from '../../shared/schema';
import { ApiError, castImagePath, fetchReveal, markOpened, markViewed } from '../api';
import { button, h } from '../dom';
import { createMotionSensor, type MotionSensor } from './motion';
import { REVEAL_FACTORIES } from './registry';
import { createSfx, type Sfx } from './sfx';
import { createStage, type StageCast } from './stage';

/** A token source with `preview` set shows the real reveal without recording the visit. */
export type RevealSource =
  { type: 'token'; token: string; preview: boolean } | { type: 'preview'; reveal: RevealKind };

const CARD_DELAY_MS = 380;
const LETTER_STAGGER_MS = 55;
/** Space kept between the cast and the text above and below it. */
const CAST_MARGIN = 6;

function previewData(reveal: RevealKind): RevealResponse {
  return {
    title: 'Preview',
    note: '',
    giverName: 'Preview',
    receiverName: 'Sample Name',
    reveal,
    cast: [],
  };
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

/** Carried across replays so sound stays unlocked and the mute and motion choices stick. */
interface Session {
  sfx: Sfx;
  motion: MotionSensor;
  muted: boolean;
  /** True once the name has been revealed and the person is trying another reveal. */
  replay: boolean;
}

function start(
  root: HTMLElement,
  source: RevealSource,
  data: RevealResponse,
  session: Session,
): void {
  const { sfx } = session;
  const canvas = h('canvas', { class: 'reveal__canvas' });
  const header = h(
    'header',
    { class: 'reveal__header' },
    h('p', { class: 'reveal__title' }, data.title || 'Kris Kringle'),
    h('h1', {}, `Hi ${data.giverName}`),
  );
  const hint = h('p', { class: 'reveal__hint', 'aria-live': 'polite' });
  const progressBar = h('div', { class: 'progress__bar' });
  const panel = h(
    'div',
    { class: 'card__panel' },
    h('p', { class: 'card__label' }, `${data.giverName}, you're buying for`),
    renderName(data.receiverName),
    h('div', { class: 'card__rule', 'aria-hidden': 'true' }),
  );
  const card = h(
    'section',
    { class: 'card', hidden: '' },
    h('div', { class: 'card__rays', 'aria-hidden': 'true' }),
    panel,
  );
  if (data.note) panel.append(h('p', { class: 'card__note' }, data.note));

  const choices = h('div', { class: 'card__choices' });
  for (const kind of REVEAL_KINDS) {
    if (kind === data.reveal) continue;
    choices.append(
      button(REVEAL_LABELS[kind], 'card__choice', () => {
        stage.destroy();
        start(root, source, { ...data, reveal: kind }, { ...session, replay: true });
      }),
    );
  }
  const again = h('div', { class: 'card__again' }, h('p', {}, 'Try another'), choices);
  card.append(again);

  const sound = button(session.muted ? 'Sound off' : 'Sound on', 'reveal__sound', () => {
    session.muted = !session.muted;
    sfx.setMuted(session.muted);
    sound.textContent = session.muted ? 'Sound off' : 'Sound on';
  });

  const { motion } = session;
  const motionToggle = button('', 'reveal__motion', () => motion.toggle());
  function showMotion(): void {
    motionToggle.hidden = motion.state === 'unavailable';
    motionToggle.textContent = motion.state === 'on' ? 'Motion on' : 'Motion off';
  }
  motion.onChange = showMotion;
  showMotion();

  const footer = h(
    'footer',
    { class: 'reveal__footer' },
    hint,
    h('div', { class: 'progress' }, progressBar),
    ...(data.cast.length > 0
      ? [h('p', { class: 'reveal__cast-hint' }, 'Tap a character to change their mood')]
      : []),
  );
  let cast: StageCast | undefined;
  if (source.type === 'token' && data.cast.length > 0) {
    const { token } = source;
    cast = {
      canvas: h('canvas', { class: 'reveal__cast' }),
      images: data.cast.map((id) => castImagePath(token, id)),
      band() {
        const stage = canvas.getBoundingClientRect();
        return {
          top: card.hidden
            ? header.getBoundingClientRect().bottom - stage.top + CAST_MARGIN
            : sound.getBoundingClientRect().bottom - stage.top + CAST_MARGIN,
          bottom: card.hidden
            ? footer.getBoundingClientRect().top - stage.top - CAST_MARGIN
            : again.offsetTop - CAST_MARGIN,
        };
      },
      obstacles() {
        if (card.hidden) return [];
        // Offset geometry reserves the final panel size throughout its entrance animation.
        return [
          {
            x: panel.offsetLeft + panel.offsetWidth / 2,
            y: panel.offsetTop + panel.offsetHeight / 2,
            halfWidth: panel.offsetWidth / 2 + CAST_MARGIN,
            halfHeight: panel.offsetHeight / 2 + CAST_MARGIN,
            round: false,
          },
        ];
      },
    };
  }

  const page = h(
    'main',
    { class: cast ? 'reveal reveal--cast' : 'reveal' },
    ...(cast ? [cast.canvas] : []),
    canvas,
    header,
    sound,
    motionToggle,
    ...(source.type === 'token' && source.preview
      ? [h('p', { class: 'reveal__badge' }, 'Preview: not recorded')]
      : []),
    footer,
    card,
  );
  root.replaceChildren(page);

  const stage = createStage({
    canvas,
    cast,
    receiverName: data.receiverName,
    factory: REVEAL_FACTORIES[data.reveal],
    sfx,
    motion,
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
        stage.refreshLayout();
      }, CARD_DELAY_MS);
      if (source.type === 'token' && !source.preview && !session.replay) {
        // Only affects the admin's "opened" column, so a failure here is safe to ignore.
        markOpened(source.token).catch(() => undefined);
      }
    },
  });
}

export function mountReveal(root: HTMLElement, source: RevealSource): void {
  document.body.className = 'reveal-body';

  const session: Session = {
    sfx: createSfx(),
    motion: createMotionSensor(),
    muted: false,
    replay: false,
  };

  if (source.type === 'preview') {
    start(root, source, previewData(source.reveal), session);
    return;
  }

  renderMessage(root, 'Loading');
  fetchReveal(source.token).then(
    (data) => {
      start(root, source, data, session);
      // Only feeds the admin's activity chart, so a failure here is safe to ignore.
      if (!source.preview) markViewed(source.token).catch(() => undefined);
    },
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        renderMessage(root, 'Names have not been drawn yet. Try this link again later.');
      } else if (error instanceof ApiError && error.status === 429) {
        renderMessage(root, 'Too many attempts. Try again in 15 minutes.');
      } else if (error instanceof ApiError && error.status === 404) {
        renderMessage(root, 'This link is not valid. Ask the organiser for a new one.');
      } else {
        renderMessage(root, 'Could not load. Check your connection and reload.');
      }
    },
  );
}
