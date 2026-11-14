import {
  MAIN_EVENT_ID,
  REVEAL_KINDS,
  REVEAL_LABELS,
  revealKindSchema,
  type AdminPerson,
  type AdminState,
  type EventSummary,
} from '../../shared/schema';
import { ApiError, adminApi } from '../api';
import { button, h } from '../dom';
import { renderActivity } from './activity';
import { createCharacterPanels } from './characters';
import {
  conflictsWithDraw,
  exclusionsOf,
  renderExclusionGrid,
  sameExclusions,
  toRequest,
  type ExclusionMap,
} from './exclusions';

const PASSWORD_KEY = 'kk-admin-password';
const EVENT_PARAM = 'event';
const CLEARS_DRAW_WARNING =
  'This clears the current draw and everyone will need a new draw. Continue?';
const EXCLUSIONS_CLEAR_DRAW_WARNING =
  'These exclusions rule out the current draw, so saving clears it. Continue?';
const DISCARD_EXCLUSIONS_WARNING = 'Discard unsaved exclusion changes?';

function loadPassword(): string {
  try {
    return window.sessionStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

function storePassword(password: string): void {
  try {
    if (password) window.sessionStorage.setItem(PASSWORD_KEY, password);
    else window.sessionStorage.removeItem(PASSWORD_KEY);
  } catch {
    // Storage is unavailable; the password just won't survive a reload.
  }
}

function eventFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get(EVENT_PARAM);
}

function writeEventToUrl(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(EVENT_PARAM, id);
  window.history.replaceState(null, '', url);
}

function revealLink(person: AdminPerson): string {
  return `${window.location.origin}/r/${person.token}`;
}

function previewLink(current: AdminState, person: AdminPerson): string {
  return current.drawn ? `/r/${person.token}?preview` : `/preview/${person.reveal}`;
}

function summaryOf(state: AdminState): EventSummary {
  return { id: state.id, title: state.title, peopleCount: state.people.length, drawn: state.drawn };
}

function eventLabel(event: { title: string }): string {
  return event.title || 'Untitled event';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function flash(element: HTMLButtonElement, label: string): void {
  const original = element.textContent ?? '';
  element.textContent = label;
  window.setTimeout(() => {
    element.textContent = original;
  }, 1400);
}

export function mountAdmin(root: HTMLElement): void {
  let password = loadPassword();
  let events: EventSummary[] = [];
  let state: AdminState | null = null;
  let showAssignments = false;
  /** Unsaved exclusion edits for the current event, or null when there are none. */
  let exclusionDraft: ExclusionMap | null = null;
  let bothWays = true;
  let activityPersonId = '';
  let message = '';
  let busy = false;

  const characters = createCharacterPanels({
    password: () => password,
    run,
    applyState,
    render,
  });

  document.title = 'Kris Kringle admin';
  document.body.className = 'admin-body';

  function signOut(reason: string): void {
    password = '';
    state = null;
    events = [];
    storePassword('');
    characters.reset();
    message = reason;
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await action();
      message = '';
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) signOut('Wrong password');
      else message = error instanceof Error ? error.message : 'Request failed';
    }
    busy = false;
    render();
  }

  function applyState(next: AdminState): void {
    if (state?.id !== next.id) {
      exclusionDraft = null;
      showAssignments = false;
      activityPersonId = '';
    }
    if (exclusionDraft) {
      const ids = new Set(next.people.map((person) => person.id));
      const pruned: ExclusionMap = new Map();
      for (const person of next.people) {
        const excluded = exclusionDraft.get(person.id) ?? new Set(person.exclusions);
        pruned.set(person.id, new Set([...excluded].filter((id) => ids.has(id))));
      }
      exclusionDraft = sameExclusions(pruned, exclusionsOf(next.people)) ? null : pruned;
    }
    if (!next.people.some((person) => person.id === activityPersonId)) activityPersonId = '';
    state = next;
    const summary = summaryOf(next);
    events = events.some((event) => event.id === next.id)
      ? events.map((event) => (event.id === next.id ? summary : event))
      : [...events, summary];
    writeEventToUrl(next.id);
  }

  /** Runs a change to the current event. */
  function update(call: (password: string, eventId: string) => Promise<AdminState>): void {
    const current = state;
    if (!current) return;
    void run(async () => applyState(await call(password, current.id)));
  }

  async function loadEvent(preferredId: string | null): Promise<void> {
    events = (await adminApi.events(password)).events;
    const target =
      events.find((event) => event.id === preferredId) ??
      events.find((event) => event.id === MAIN_EVENT_ID) ??
      events[0];
    if (!target) throw new Error('No events found');
    applyState(await adminApi.event(password, target.id));
    await characters.load();
  }

  function confirmClearsDraw(current: AdminState): boolean {
    return !current.drawn || window.confirm(CLEARS_DRAW_WARNING);
  }

  function confirmDiscardDraft(): boolean {
    if (!exclusionDraft) return true;
    if (!window.confirm(DISCARD_EXCLUSIONS_WARNING)) return false;
    exclusionDraft = null;
    return true;
  }

  function renderLogin(): HTMLElement {
    const input = h('input', {
      type: 'password',
      name: 'password',
      autocomplete: 'current-password',
      'aria-label': 'Admin password',
      placeholder: 'Admin password',
    });
    const form = h(
      'form',
      { class: 'panel login' },
      h('h1', {}, 'Kris Kringle admin'),
      input,
      h('button', { type: 'submit', class: 'btn btn--primary' }, 'Sign in'),
    );
    if (message) form.append(h('p', { class: 'error', role: 'alert' }, message));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      password = input.value;
      storePassword(password);
      void run(() => loadEvent(eventFromUrl()));
    });
    return form;
  }

  function renderEvents(current: AdminState): HTMLElement {
    const tabs = h('nav', { class: 'event-tabs', 'aria-label': 'Events' });
    for (const event of events) {
      const active = event.id === current.id;
      const tab = button(
        `${eventLabel(event)} (${event.peopleCount})`,
        active ? 'event-tab is-active' : 'event-tab',
        () => {
          if (active || !confirmDiscardDraft()) return;
          void run(async () => applyState(await adminApi.event(password, event.id)));
        },
      );
      if (active) tab.setAttribute('aria-current', 'page');
      tabs.append(tab);
    }

    const name = h('input', {
      type: 'text',
      maxlength: '80',
      'aria-label': 'New event name',
      placeholder: 'New event name',
      required: '',
    });
    const create = h(
      'form',
      { class: 'inline-form' },
      name,
      h('button', { type: 'submit', class: 'btn' }, 'Create event'),
    );
    create.addEventListener('submit', (event) => {
      event.preventDefault();
      const title = name.value.trim();
      if (!title || !confirmDiscardDraft()) return;
      void run(async () => applyState(await adminApi.createEvent(password, { title })));
    });

    return h('section', { class: 'panel' }, h('h2', {}, 'Events'), tabs, create);
  }

  function renderSettings(current: AdminState): HTMLElement {
    const title = h('input', { type: 'text', id: 'event-title', maxlength: '80' });
    title.value = current.title;
    const note = h('input', { type: 'text', id: 'event-note', maxlength: '200' });
    note.value = current.note;
    const actions = h(
      'div',
      { class: 'actions' },
      h('button', { type: 'submit', class: 'btn' }, 'Save'),
    );
    if (current.id !== MAIN_EVENT_ID) {
      actions.append(
        button('Delete event', 'btn btn--quiet', () => {
          const prompt = `Delete "${eventLabel(current)}" and all its links? This cannot be undone.`;
          if (!window.confirm(prompt)) return;
          void run(async () => {
            events = (await adminApi.deleteEvent(password, current.id)).events;
            await loadEvent(null);
          });
        }),
      );
    }
    const form = h(
      'form',
      { class: 'panel' },
      h('h2', {}, 'Event details'),
      h(
        'div',
        { class: 'fields' },
        h('label', { for: 'event-title' }, 'Name', title),
        h('label', { for: 'event-note' }, 'Details shown after the reveal (budget, date)', note),
      ),
      actions,
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      update((pw, id) => adminApi.saveSettings(pw, id, { title: title.value, note: note.value }));
    });
    return form;
  }

  function renderStatus(person: AdminPerson): HTMLElement {
    let label = 'Not opened';
    if (person.opened) label = 'Revealed';
    else if (person.views.length > 0) label = 'Viewed';
    const cell = h('td', { class: person.opened ? 'cell-status' : 'cell-status muted' }, label);
    if (person.views.length > 0 || person.completions.length > 0) {
      cell.append(
        h(
          'span',
          { class: 'cell-sub' },
          `${plural(person.views.length, 'view')} · ${plural(person.completions.length, 'reveal')}`,
        ),
      );
    }
    return cell;
  }

  function renderPersonRow(current: AdminState, person: AdminPerson): HTMLElement {
    const select = h('select', { 'aria-label': `Reveal for ${person.name}` });
    for (const kind of REVEAL_KINDS) {
      const option = h('option', { value: kind }, REVEAL_LABELS[kind]);
      option.selected = kind === person.reveal;
      select.append(option);
    }
    select.addEventListener('change', () => {
      const kind = revealKindSchema.safeParse(select.value);
      if (kind.success) update((pw, id) => adminApi.setReveal(pw, id, person.id, kind.data));
    });

    const receiver = current.people.find((other) => other.id === person.receiverId);
    let assignment = '—';
    if (receiver) assignment = showAssignments ? receiver.name : 'Hidden';

    const copy = button('Copy link', 'btn btn--small', () => {
      void navigator.clipboard.writeText(revealLink(person)).then(() => flash(copy, 'Copied'));
    });
    copy.disabled = !current.drawn;
    const remove = button('Remove', 'btn btn--small btn--quiet', () => {
      if (confirmClearsDraw(current)) {
        update((pw, id) => adminApi.removePerson(pw, id, person.id));
      }
    });

    return h(
      'tr',
      {},
      h('td', { class: 'cell-name' }, person.name),
      h(
        'td',
        {},
        h(
          'div',
          { class: 'cell-reveal' },
          select,
          h(
            'a',
            {
              href: previewLink(current, person),
              target: '_blank',
              rel: 'noopener',
              title: current.drawn
                ? 'Opens their real link without recording a view'
                : 'Sample of this reveal',
            },
            'Preview',
          ),
        ),
      ),
      h('td', { class: showAssignments && receiver ? '' : 'muted' }, assignment),
      renderStatus(person),
      h('td', { class: 'cell-actions' }, copy, remove),
    );
  }

  function renderPeople(current: AdminState): HTMLElement {
    const names = h('textarea', {
      rows: '4',
      'aria-label': 'Names to add, one per line',
      placeholder: 'One name per line',
    });
    const addForm = h(
      'form',
      { class: 'add-people' },
      names,
      h('button', { type: 'submit', class: 'btn' }, 'Add people'),
    );
    addForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const list = names.value
        .split('\n')
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (list.length === 0 || !confirmClearsDraw(current)) return;
      update((pw, id) => adminApi.addPeople(pw, id, { names: list }));
    });

    const panel = h(
      'section',
      { class: 'panel' },
      h('h2', {}, `People (${current.people.length})`),
    );
    if (current.people.length > 0) {
      const body = h('tbody', {});
      for (const person of current.people) body.append(renderPersonRow(current, person));
      panel.append(
        h(
          'div',
          { class: 'table-scroll' },
          h(
            'table',
            {},
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, 'Name'),
                h('th', {}, 'Reveal'),
                h('th', {}, 'Buying for'),
                h('th', {}, 'Status'),
                h('th', {}, 'Link'),
              ),
            ),
            body,
          ),
        ),
      );
    }
    panel.append(addForm);
    return panel;
  }

  function renderExclusions(current: AdminState): HTMLElement {
    const saved = exclusionsOf(current.people);
    const exclusions = exclusionDraft ?? saved;
    const total = [...exclusions.values()].reduce((sum, excluded) => sum + excluded.size, 0);

    function toggle(giverId: string, receiverId: string): void {
      const next: ExclusionMap = new Map(
        [...exclusions].map(([id, excluded]) => [id, new Set(excluded)]),
      );
      const turnOn = !next.get(giverId)?.has(receiverId);
      const pairs: [string, string][] = [[giverId, receiverId]];
      if (bothWays) pairs.push([receiverId, giverId]);
      for (const [from, to] of pairs) {
        const excluded = next.get(from) ?? new Set<string>();
        if (turnOn) excluded.add(to);
        else excluded.delete(to);
        next.set(from, excluded);
      }
      exclusionDraft = sameExclusions(next, saved) ? null : next;
      render();
    }

    const both = h('input', { type: 'checkbox' });
    both.checked = bothWays;
    both.addEventListener('change', () => {
      bothWays = both.checked;
    });

    const save = button('Save exclusions', 'btn btn--primary', () => {
      const draft = exclusionDraft;
      if (!draft) return;
      if (current.drawn && conflictsWithDraw(current.people, draft)) {
        if (!window.confirm(EXCLUSIONS_CLEAR_DRAW_WARNING)) return;
      }
      update(async (pw, id) => {
        const next = await adminApi.saveExclusions(pw, id, toRequest(draft));
        exclusionDraft = null;
        return next;
      });
    });
    save.disabled = !exclusionDraft;
    const actions = h('div', { class: 'actions' }, save);
    if (exclusionDraft) {
      actions.append(
        button('Discard', 'btn btn--quiet', () => {
          exclusionDraft = null;
          render();
        }),
        h('p', { class: 'status' }, 'Unsaved changes'),
      );
    }

    return h(
      'section',
      { class: 'panel' },
      h('h2', {}, `Exclusions (${total})`),
      h(
        'p',
        { class: 'status' },
        "Click a cell to stop the row's person drawing the column's person.",
      ),
      h('label', { class: 'check' }, both, 'Both ways'),
      renderExclusionGrid(current.people, exclusions, toggle),
      actions,
    );
  }

  function renderDraw(current: AdminState): HTMLElement {
    const opened = current.people.filter((person) => person.opened).length;
    let status = current.drawn
      ? `Drawn. ${opened} of ${current.people.length} people have revealed.`
      : 'Not drawn.';
    if (exclusionDraft) status = 'Save or discard exclusion changes before drawing.';

    const draw = button(current.drawn ? 'Redraw' : 'Draw names', 'btn btn--primary', () => {
      if (current.drawn && !window.confirm('Redraw? Links stay the same but assignments change.')) {
        return;
      }
      update(adminApi.draw);
    });
    draw.disabled = current.people.length < 2 || exclusionDraft !== null;

    const actions = h('div', { class: 'actions' }, draw);
    if (current.drawn) {
      const copyAll = button('Copy all links', 'btn', () => {
        const text = current.people
          .map((person) => `${person.name}: ${revealLink(person)}`)
          .join('\n');
        void navigator.clipboard.writeText(text).then(() => flash(copyAll, 'Copied'));
      });
      actions.append(
        copyAll,
        button(showAssignments ? 'Hide assignments' : 'Show assignments', 'btn', () => {
          showAssignments = !showAssignments;
          render();
        }),
        button('Clear draw', 'btn btn--quiet', () => {
          if (window.confirm('Clear the draw? Existing links stop working until you draw again.')) {
            update(adminApi.clearDraw);
          }
        }),
      );
    }

    return h(
      'section',
      { class: 'panel' },
      h('h2', {}, 'Draw'),
      h('p', { class: 'status' }, status),
      actions,
    );
  }

  function renderActivityPanel(current: AdminState): HTMLElement {
    const filter = h('select', { 'aria-label': 'Show activity for' });
    filter.append(h('option', { value: '' }, 'Everyone'));
    for (const person of current.people) {
      const option = h('option', { value: person.id }, person.name);
      option.selected = person.id === activityPersonId;
      filter.append(option);
    }
    filter.addEventListener('change', () => {
      activityPersonId = filter.value;
      render();
    });
    const people = activityPersonId
      ? current.people.filter((person) => person.id === activityPersonId)
      : current.people;
    return h(
      'section',
      { class: 'panel panel--wide' },
      h('div', { class: 'panel__header' }, h('h2', {}, 'Activity'), filter),
      renderActivity(people),
    );
  }

  function renderDashboard(current: AdminState): HTMLElement {
    const page = h(
      'main',
      { class: 'admin' },
      h(
        'header',
        { class: 'admin__header' },
        h('h1', {}, 'Kris Kringle admin'),
        button('Sign out', 'btn btn--quiet', () => {
          signOut('');
          render();
        }),
      ),
    );
    if (message) page.append(h('p', { class: 'error', role: 'alert' }, message));
    page.append(renderEvents(current), renderSettings(current), renderPeople(current));
    if (current.people.length >= 2) page.append(renderExclusions(current));
    page.append(characters.renderEventCharacters(current), renderDraw(current));
    if (current.drawn) page.append(renderActivityPanel(current));
    page.append(characters.renderLibrary());
    return page;
  }

  function render(): void {
    const scroller = root.querySelector('.grid-scroll');
    const scrollLeft = scroller?.scrollLeft ?? 0;
    const active = document.activeElement;
    const focusKey = active instanceof HTMLElement ? active.dataset.focusKey : undefined;
    const pageScroll = window.scrollY;

    root.replaceChildren(state ? renderDashboard(state) : renderLogin());

    const nextScroller = root.querySelector('.grid-scroll');
    if (nextScroller) nextScroller.scrollLeft = scrollLeft;
    if (focusKey) {
      const target = root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    }
    window.scrollTo(0, pageScroll);
  }

  render();
  if (password) void run(() => loadEvent(eventFromUrl()));
}
