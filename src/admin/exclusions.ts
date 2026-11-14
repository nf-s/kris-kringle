import type { AdminPerson, ExclusionsRequest } from '../../shared/schema';
import { h } from '../dom';

/** Excluded receiver ids keyed by giver id. */
export type ExclusionMap = Map<string, Set<string>>;

export function exclusionsOf(people: readonly AdminPerson[]): ExclusionMap {
  return new Map(people.map((person) => [person.id, new Set(person.exclusions)]));
}

export function sameExclusions(a: ExclusionMap, b: ExclusionMap): boolean {
  if (a.size !== b.size) return false;
  for (const [id, excluded] of a) {
    const other = b.get(id);
    if (!other || other.size !== excluded.size) return false;
    for (const excludedId of excluded) if (!other.has(excludedId)) return false;
  }
  return true;
}

export function toRequest(exclusions: ExclusionMap): ExclusionsRequest {
  return {
    exclusions: Object.fromEntries([...exclusions].map(([id, excluded]) => [id, [...excluded]])),
  };
}

/** True if the current draw gives someone a person the exclusions now rule out. */
export function conflictsWithDraw(
  people: readonly AdminPerson[],
  exclusions: ExclusionMap,
): boolean {
  return people.some(
    (person) => person.receiverId !== null && exclusions.get(person.id)?.has(person.receiverId),
  );
}

export function cellKey(giverId: string, receiverId: string): string {
  return `exclusion:${giverId}:${receiverId}`;
}

/**
 * Grid of givers (rows) against receivers (columns). A marked cell means the row's person cannot
 * draw the column's person.
 */
export function renderExclusionGrid(
  people: readonly AdminPerson[],
  exclusions: ExclusionMap,
  onToggle: (giverId: string, receiverId: string) => void,
): HTMLElement {
  const headRow = h('tr', {}, h('th', { class: 'grid__corner' }, "Can't draw →"));
  for (const receiver of people) {
    headRow.append(h('th', { class: 'grid__col', scope: 'col' }, h('span', {}, receiver.name)));
  }

  const body = h('tbody', {});
  for (const giver of people) {
    const excluded = exclusions.get(giver.id) ?? new Set<string>();
    const row = h(
      'tr',
      {},
      h(
        'th',
        { class: 'grid__row', scope: 'row' },
        giver.name,
        excluded.size > 0 ? h('span', { class: 'grid__count' }, String(excluded.size)) : '',
      ),
    );
    for (const receiver of people) {
      if (receiver.id === giver.id) {
        row.append(h('td', { class: 'grid__cell grid__cell--self', 'aria-hidden': 'true' }));
        continue;
      }
      const isExcluded = excluded.has(receiver.id);
      const cell = h(
        'button',
        {
          type: 'button',
          class: isExcluded ? 'grid__toggle is-on' : 'grid__toggle',
          'aria-pressed': String(isExcluded),
          'aria-label': `${giver.name} can't draw ${receiver.name}`,
          title: `${giver.name} can't draw ${receiver.name}`,
          'data-focus-key': cellKey(giver.id, receiver.id),
        },
        isExcluded ? '✕' : '',
      );
      cell.addEventListener('click', () => onToggle(giver.id, receiver.id));
      row.append(h('td', { class: 'grid__cell' }, cell));
    }
    body.append(row);
  }

  return h(
    'div',
    { class: 'table-scroll grid-scroll' },
    h('table', { class: 'grid' }, h('thead', {}, headRow), body),
  );
}
