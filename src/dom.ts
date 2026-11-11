type Child = Node | string;

/** Creates an element with attributes and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = h('button', { type: 'button', class: className }, label);
  element.addEventListener('click', onClick);
  return element;
}
