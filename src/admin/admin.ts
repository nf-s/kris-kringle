import {
  REVEAL_KINDS,
  REVEAL_LABELS,
  revealKindSchema,
  type AdminPerson,
  type AdminState,
} from '../../shared/schema';
import { ApiError, adminApi } from '../api';
import { button, h } from '../dom';

const PASSWORD_KEY = 'kk-admin-password';
const CLEARS_DRAW_WARNING =
  'This clears the current draw and everyone will need a new draw. Continue?';

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

function revealLink(person: AdminPerson): string {
  return `${window.location.origin}/r/${person.token}`;
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
  let state: AdminState | null = null;
  let showAssignments = false;
  let message = '';
  let busy = false;

  document.title = 'Kris Kringle admin';
  document.body.className = 'admin-body';

  async function run(action: (password: string) => Promise<AdminState>): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      state = await action(password);
      message = '';
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        password = '';
        state = null;
        storePassword('');
        message = 'Wrong password';
      } else {
        message = error instanceof Error ? error.message : 'Request failed';
      }
    }
    busy = false;
    render();
  }

  function confirmClearsDraw(current: AdminState): boolean {
    return !current.drawn || window.confirm(CLEARS_DRAW_WARNING);
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
      void run(adminApi.state);
    });
    return form;
  }

  function renderSettings(current: AdminState): HTMLElement {
    const title = h('input', { type: 'text', id: 'event-title', maxlength: '80' });
    title.value = current.title;
    const note = h('input', { type: 'text', id: 'event-note', maxlength: '200' });
    note.value = current.note;
    const form = h(
      'form',
      { class: 'panel' },
      h('h2', {}, 'Event'),
      h(
        'div',
        { class: 'fields' },
        h('label', { for: 'event-title' }, 'Name', title),
        h('label', { for: 'event-note' }, 'Details shown after the reveal (budget, date)', note),
      ),
      h('button', { type: 'submit', class: 'btn' }, 'Save'),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void run((pw) => adminApi.saveSettings(pw, { title: title.value, note: note.value }));
    });
    return form;
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
      if (kind.success) void run((pw) => adminApi.setReveal(pw, person.id, kind.data));
    });

    const receiver = current.people.find((other) => other.id === person.receiverId);
    let assignment = '—';
    if (receiver) assignment = showAssignments ? receiver.name : 'Hidden';

    const copy = button('Copy link', 'btn btn--small', () => {
      void navigator.clipboard.writeText(revealLink(person)).then(() => flash(copy, 'Copied'));
    });
    copy.disabled = !current.drawn;
    const remove = button('Remove', 'btn btn--small btn--quiet', () => {
      if (confirmClearsDraw(current)) void run((pw) => adminApi.removePerson(pw, person.id));
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
            { href: `/preview/${person.reveal}`, target: '_blank', rel: 'noopener' },
            'Preview',
          ),
        ),
      ),
      h('td', { class: showAssignments && receiver ? '' : 'muted' }, assignment),
      h('td', { class: person.opened ? '' : 'muted' }, person.opened ? 'Opened' : 'Not opened'),
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
      void run((pw) => adminApi.addPeople(pw, { names: list }));
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

  function renderDraw(current: AdminState): HTMLElement {
    const opened = current.people.filter((person) => person.opened).length;
    const status = current.drawn
      ? `Drawn. ${opened} of ${current.people.length} links opened.`
      : 'Not drawn.';

    const draw = button(current.drawn ? 'Redraw' : 'Draw names', 'btn btn--primary', () => {
      if (current.drawn && !window.confirm('Redraw? Links stay the same but assignments change.')) {
        return;
      }
      void run(adminApi.draw);
    });
    draw.disabled = current.people.length < 2;

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
            void run(adminApi.clearDraw);
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

  function renderDashboard(current: AdminState): HTMLElement {
    const signOut = button('Sign out', 'btn btn--quiet', () => {
      password = '';
      state = null;
      storePassword('');
      render();
    });
    const page = h(
      'main',
      { class: 'admin' },
      h('header', { class: 'admin__header' }, h('h1', {}, 'Kris Kringle admin'), signOut),
    );
    if (message) page.append(h('p', { class: 'error', role: 'alert' }, message));
    page.append(renderSettings(current), renderPeople(current), renderDraw(current));
    return page;
  }

  function render(): void {
    root.replaceChildren(state ? renderDashboard(state) : renderLogin());
  }

  render();
  if (password) void run(adminApi.state);
}
