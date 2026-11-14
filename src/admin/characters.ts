import type { AdminState, Character } from '../../shared/schema';
import { ApiError, adminApi } from '../api';
import { CharacterImportError, importCharacters } from '../characters/import';
import { drawThumbnail } from '../characters/sprite';
import { button, h } from '../dom';

/** Canvas pixels; CSS shows thumbnails at half this size. */
const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 120;

interface CharacterPanelOptions {
  password: () => string;
  /** Runs an action with the admin page's busy state and error handling, then re-renders. */
  run: (action: () => Promise<void>) => Promise<void>;
  applyState: (next: AdminState) => void;
  render: () => void;
}

export interface CharacterPanels {
  load(): Promise<void>;
  reset(): void;
  renderLibrary(): HTMLElement;
  renderEventCharacters(current: AdminState): HTMLElement;
}

function deleteWarning(character: Character): string {
  return `Delete "${character.name}"? It is removed from every event. This cannot be undone.`;
}

export function createCharacterPanels(options: CharacterPanelOptions): CharacterPanels {
  let characters: Character[] = [];
  /** Decoded images by character id, kept for the page session. */
  const images = new Map<string, Promise<ImageBitmap>>();
  let importStatus = '';
  let importFailed = false;
  /** Unsaved attachment edits for one event. */
  let draft: { eventId: string; ids: Set<string> } | null = null;

  function image(id: string): Promise<ImageBitmap> {
    const cached = images.get(id);
    if (cached) return cached;
    const loading = adminApi
      .characterImage(options.password(), id)
      .then((blob) => createImageBitmap(blob));
    images.set(id, loading);
    void loading.catch(() => images.delete(id));
    return loading;
  }

  function forgetImage(id: string): void {
    void images.get(id)?.then(
      (bitmap) => bitmap.close(),
      () => undefined,
    );
    images.delete(id);
  }

  function thumbnail(character: Character): HTMLCanvasElement {
    const canvas = h('canvas', {
      class: 'character-thumb',
      width: String(THUMB_WIDTH),
      height: String(THUMB_HEIGHT),
      'aria-hidden': 'true',
    });
    void image(character.id).then(
      (bitmap) => drawThumbnail(canvas, bitmap),
      () => canvas.classList.add('is-missing'),
    );
    return canvas;
  }

  async function importFolder(files: File[]): Promise<void> {
    importFailed = false;
    importStatus = 'Reading folder';
    options.render();
    let done = 0;
    let total = 0;
    try {
      const imported = await importCharacters(files);
      total = imported.length;
      for (const character of imported) {
        importStatus = `Importing ${done + 1} of ${total}`;
        options.render();
        const existing = characters.find((other) => other.name === character.name);
        const password = options.password();
        if (existing) {
          characters = (
            await adminApi.updateCharacter(password, existing.id, existing.name, character.sprite)
          ).characters;
          forgetImage(existing.id);
        } else {
          characters = (await adminApi.createCharacter(password, character.name, character.sprite))
            .characters;
        }
        done++;
      }
      importStatus = `Imported ${done} of ${total}`;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      importFailed = true;
      const reason = error instanceof Error ? error.message : 'Import failed';
      importStatus =
        error instanceof CharacterImportError || total === 0
          ? reason
          : `Stopped after ${done} of ${total}: ${reason}`;
    }
  }

  function renderImport(): HTMLElement {
    const input = h('input', {
      type: 'file',
      class: 'character-import__input',
      webkitdirectory: '',
      multiple: '',
      'aria-label': 'Character folder',
    });
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      if (files.length > 0) void options.run(() => importFolder(files));
    });
    const control = h(
      'div',
      { class: 'character-import' },
      h('label', { class: 'btn' }, 'Import folder', input),
    );
    if (importStatus) {
      control.append(
        h(
          'p',
          importFailed ? { class: 'error', role: 'alert' } : { class: 'status', role: 'status' },
          importStatus,
        ),
      );
    }
    return control;
  }

  function renderLibraryRow(character: Character): HTMLElement {
    const name = h('input', {
      type: 'text',
      maxlength: '40',
      required: '',
      'aria-label': `Name for ${character.name}`,
      'data-focus-key': `character-name:${character.id}`,
    });
    name.value = character.name;
    const rename = h(
      'form',
      { class: 'inline-form' },
      name,
      h('button', { type: 'submit', class: 'btn btn--small' }, 'Rename'),
    );
    rename.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = name.value.trim();
      if (!next || next === character.name) return;
      void options.run(async () => {
        characters = (await adminApi.updateCharacter(options.password(), character.id, next))
          .characters;
      });
    });
    const remove = button('Delete', 'btn btn--small btn--quiet', () => {
      if (!window.confirm(deleteWarning(character))) return;
      void options.run(async () => {
        characters = (await adminApi.deleteCharacter(options.password(), character.id)).characters;
        forgetImage(character.id);
      });
    });
    return h('li', { class: 'character-row' }, thumbnail(character), rename, remove);
  }

  function renderLibrary(): HTMLElement {
    const panel = h(
      'section',
      { class: 'panel panel--wide' },
      h('h2', {}, `Character library (${characters.length})`),
      h(
        'p',
        { class: 'status' },
        'Shared by all events. Importing a character with an existing name replaces its image.',
      ),
      renderImport(),
    );
    if (characters.length > 0) {
      panel.append(h('ul', { class: 'character-list' }, ...characters.map(renderLibraryRow)));
    }
    return panel;
  }

  function renderEventCharacters(current: AdminState): HTMLElement {
    const libraryIds = new Set(characters.map((character) => character.id));
    const saved = new Set(current.characterIds.filter((id) => libraryIds.has(id)));
    const picked = draft?.eventId === current.id ? [...draft.ids] : [...saved];
    const selected = new Set(picked.filter((id) => libraryIds.has(id)));
    const changed = selected.size !== saved.size || [...selected].some((id) => !saved.has(id));

    const panel = h(
      'section',
      { class: 'panel panel--wide' },
      h('h2', {}, `Characters (${selected.size})`),
    );
    if (characters.length === 0) {
      panel.append(h('p', { class: 'status' }, 'Import characters into the library first.'));
      return panel;
    }

    const list = h('ul', { class: 'character-picks' });
    for (const character of characters) {
      const box = h('input', {
        type: 'checkbox',
        'data-focus-key': `character-pick:${character.id}`,
      });
      box.checked = selected.has(character.id);
      box.addEventListener('change', () => {
        const ids = new Set(selected);
        if (box.checked) ids.add(character.id);
        else ids.delete(character.id);
        draft = { eventId: current.id, ids };
        options.render();
      });
      list.append(
        h(
          'li',
          {},
          h(
            'label',
            { class: 'character-pick' },
            box,
            thumbnail(character),
            h('span', {}, character.name),
          ),
        ),
      );
    }

    const save = button('Save characters', 'btn btn--primary', () => {
      const characterIds = characters
        .map((character) => character.id)
        .filter((id) => selected.has(id));
      void options.run(async () => {
        const next = await adminApi.saveEventCharacters(options.password(), current.id, {
          characterIds,
        });
        draft = null;
        options.applyState(next);
      });
    });
    save.disabled = !changed;
    const actions = h('div', { class: 'actions' }, save);
    if (changed) {
      actions.append(
        button('Discard', 'btn btn--quiet', () => {
          draft = null;
          options.render();
        }),
        h('p', { class: 'status' }, 'Unsaved changes'),
      );
    }

    panel.append(
      h('p', { class: 'status' }, "Shown in this event's reveals. Does not affect the draw."),
      list,
      actions,
    );
    return panel;
  }

  return {
    async load() {
      characters = (await adminApi.characters(options.password())).characters;
    },
    reset() {
      characters = [];
      draft = null;
      importStatus = '';
      importFailed = false;
      for (const id of [...images.keys()]) forgetImage(id);
    },
    renderLibrary,
    renderEventCharacters,
  };
}
