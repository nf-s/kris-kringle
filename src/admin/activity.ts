import type { AdminPerson } from '../../shared/schema';
import { h } from '../dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 220;
const MARGIN = { top: 14, right: 44, bottom: 28, left: 34 };
const HOUR_MS = 60 * 60 * 1000;
const MIN_WIDTH = 280;

interface Series {
  label: string;
  className: string;
  /** Sorted times. */
  times: number[];
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

/** Number of times at or before `time`. `times` must be sorted. */
function countAt(times: readonly number[], time: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function niceStep(max: number): number {
  const rough = max / 4;
  if (rough <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const steps = [1, 2, 5, 10].map((step) => step * magnitude);
  return steps.find((step) => step >= rough) ?? 10 * magnitude;
}

function timeFormatter(spanMs: number): Intl.DateTimeFormat {
  return spanMs < 36 * HOUR_MS
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
}

const tooltipFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

function draw(container: HTMLElement, series: readonly Series[], now: number): void {
  const width = Math.max(MIN_WIDTH, container.clientWidth);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const allTimes = series.flatMap((line) => line.times);
  const start = Math.min(...allTimes);
  const end = Math.max(now, start + HOUR_MS);
  const maxCount = Math.max(1, ...series.map((line) => line.times.length));
  const step = niceStep(maxCount);
  const yMax = Math.ceil(maxCount / step) * step;

  const x = (time: number) => MARGIN.left + ((time - start) / (end - start)) * plotWidth;
  const y = (count: number) => MARGIN.top + plotHeight - (count / yMax) * plotHeight;

  const chart = svg('svg', {
    width,
    height: HEIGHT,
    viewBox: `0 0 ${width} ${HEIGHT}`,
    class: 'activity__svg',
    role: 'img',
    'aria-label': series.map((line) => `${line.label}: ${line.times.length}`).join(', '),
  });

  for (let value = 0; value <= yMax; value += step) {
    chart.append(
      svg('line', {
        x1: MARGIN.left,
        x2: MARGIN.left + plotWidth,
        y1: y(value),
        y2: y(value),
        class: 'activity__grid',
      }),
    );
    const label = svg('text', {
      x: MARGIN.left - 8,
      y: y(value),
      class: 'activity__axis',
      'text-anchor': 'end',
      'dominant-baseline': 'middle',
    });
    label.textContent = String(value);
    chart.append(label);
  }

  const format = timeFormatter(end - start);
  const tickCount = plotWidth < 360 ? 2 : 3;
  for (let index = 0; index < tickCount; index++) {
    const time = start + ((end - start) * index) / (tickCount - 1);
    let anchor = 'middle';
    if (index === 0) anchor = 'start';
    else if (index === tickCount - 1) anchor = 'end';
    const label = svg('text', {
      x: x(time),
      y: HEIGHT - 8,
      class: 'activity__axis',
      'text-anchor': anchor,
    });
    label.textContent = index === tickCount - 1 ? 'Now' : format.format(time);
    chart.append(label);
  }

  const endLabels: { y: number; text: string }[] = [];
  for (const line of series) {
    let path = `M${x(start)},${y(0)}`;
    line.times.forEach((time, index) => {
      path += `H${x(time)}V${y(index + 1)}`;
    });
    path += `H${x(end)}`;
    chart.append(svg('path', { d: path, class: `activity__line ${line.className}` }));
    endLabels.push({ y: y(line.times.length), text: String(line.times.length) });
  }
  // Keep the two end values readable when the lines finish at the same height.
  if (endLabels.length === 2 && Math.abs(endLabels[0].y - endLabels[1].y) < 14) {
    const middle = (endLabels[0].y + endLabels[1].y) / 2;
    const upper = endLabels[0].y <= endLabels[1].y ? 0 : 1;
    endLabels[upper].y = middle - 7;
    endLabels[1 - upper].y = middle + 7;
  }
  endLabels.forEach((label, index) => {
    const key = svg('line', {
      x1: x(end) + 6,
      x2: x(end) + 14,
      y1: label.y,
      y2: label.y,
      class: `activity__key ${series[index].className}`,
    });
    const text = svg('text', {
      x: x(end) + 18,
      y: label.y,
      class: 'activity__value',
      'dominant-baseline': 'middle',
    });
    text.textContent = label.text;
    chart.append(key, text);
  });

  const crosshair = svg('line', {
    y1: MARGIN.top,
    y2: MARGIN.top + plotHeight,
    class: 'activity__crosshair',
    visibility: 'hidden',
  });
  const markers = series.map((line) =>
    svg('circle', { r: 4, class: `activity__marker ${line.className}`, visibility: 'hidden' }),
  );
  const hitArea = svg('rect', {
    x: MARGIN.left,
    y: MARGIN.top,
    width: plotWidth,
    height: plotHeight,
    class: 'activity__hit',
  });
  chart.append(crosshair, ...markers, hitArea);

  const tooltip = h('div', { class: 'activity__tooltip', hidden: '' });

  function show(clientX: number): void {
    const bounds = chart.getBoundingClientRect();
    const px = Math.min(Math.max(clientX - bounds.left, MARGIN.left), MARGIN.left + plotWidth);
    const time = start + ((px - MARGIN.left) / plotWidth) * (end - start);
    crosshair.setAttribute('x1', String(px));
    crosshair.setAttribute('x2', String(px));
    crosshair.setAttribute('visibility', 'visible');
    const rows = series.map((line, index) => {
      const count = countAt(line.times, time);
      markers[index].setAttribute('cx', String(px));
      markers[index].setAttribute('cy', String(y(count)));
      markers[index].setAttribute('visibility', 'visible');
      return h(
        'div',
        { class: 'activity__tooltip-row' },
        h('span', { class: `activity__swatch ${line.className}` }),
        `${line.label} `,
        h('strong', {}, String(count)),
      );
    });
    tooltip.replaceChildren(h('div', { class: 'muted' }, tooltipFormat.format(time)), ...rows);
    tooltip.hidden = false;
    const flip = px > width / 2;
    tooltip.style.left = flip ? '' : `${px + 12}px`;
    tooltip.style.right = flip ? `${width - px + 12}px` : '';
  }

  function hide(): void {
    crosshair.setAttribute('visibility', 'hidden');
    for (const marker of markers) marker.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  }

  hitArea.addEventListener('pointermove', (event) => show(event.clientX));
  hitArea.addEventListener('pointerdown', (event) => show(event.clientX));
  hitArea.addEventListener('pointerleave', hide);

  container.replaceChildren(chart, tooltip);
}

/** Cumulative link views and finished reveals over time for the given people. */
export function renderActivity(people: readonly AdminPerson[]): HTMLElement {
  const series: Series[] = [
    {
      label: 'Views',
      className: 'series-1',
      times: people.flatMap((person) => person.views).sort((a, b) => a - b),
    },
    {
      label: 'Reveals',
      className: 'series-2',
      times: people.flatMap((person) => person.completions).sort((a, b) => a - b),
    },
  ];

  const legend = h(
    'div',
    { class: 'activity__legend' },
    ...series.map((line) =>
      h(
        'span',
        { class: 'activity__legend-item' },
        h('span', { class: `activity__swatch ${line.className}` }),
        line.label,
      ),
    ),
  );

  if (series.every((line) => line.times.length === 0)) {
    return h('p', { class: 'status' }, 'No views recorded for this draw yet.');
  }

  const plot = h('div', { class: 'activity__plot' });
  const now = Date.now();
  let drawnWidth = 0;
  const observer = new ResizeObserver(() => {
    if (!plot.isConnected) {
      observer.disconnect();
      return;
    }
    if (plot.clientWidth === drawnWidth) return;
    drawnWidth = plot.clientWidth;
    draw(plot, series, now);
  });
  observer.observe(plot);
  return h('div', { class: 'activity' }, legend, plot);
}
