import { mkdir, readFile, writeFile } from 'node:fs/promises';

const username = process.env.PROFILE_USERNAME || 'Yashzz26';
const secondsPerCell = Number(process.env.SNAKE_CELL_MS ?? 150) / 1000;
const dotCount = Number(process.env.SNAKE_BODY_DOTS ?? 8);
const levelColors = ['#1C222B', '#20344E', '#294D76', '#386FA8', '#58A6FF'];
const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const rows = 7;
const cellSize = 9;
const step = 11.4;
const width = 700;
const height = 176;
const directions = [[-1, 0], [0, -1], [0, 1], [1, 0]];
const number = (value) => Number(value.toFixed(6)).toString();

async function fetchCalendar() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('Set GITHUB_TOKEN to fetch the GitHub contribution calendar.');

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query ($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays { date weekday contributionCount contributionLevel }
              }
            }
          }
        }
      }`,
      variables: { login: username },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL returned HTTP ${response.status}.`);
  const { data, errors } = await response.json();
  const calendar = data?.user?.contributionsCollection?.contributionCalendar;
  if (errors?.length || !calendar) {
    throw new Error(errors?.map(({ message }) => message).join('; ') || 'GitHub did not return a calendar.');
  }
  return calendar;
}

// Find the nearest uneaten cell by walking the grid. Prefer continuing straight
// and avoid reversing into the trailing dots at the start of each search.
function findFood(path, food, columns) {
  const start = path.at(-1);
  const previous = path.at(-2);
  const parents = new Map([[start, null]]);
  const queue = [start];

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor];
    if (food.has(cell)) {
      const segment = [];
      for (let point = cell; point !== start; point = parents.get(point)) segment.push(point);
      return segment.reverse();
    }

    const parent = parents.get(cell) ?? previous;
    const heading = cell - parent;
    const x = Math.floor(cell / rows);
    const y = cell % rows;
    const choices = directions
      .map(([dx, dy]) => ({ x: x + dx, y: y + dy, offset: dx * rows + dy }))
      .filter((next) => next.x >= 0 && next.x < columns && next.y >= 0 && next.y < rows)
      .sort((a, b) => Number(b.offset === heading) - Number(a.offset === heading));
    for (const next of choices) {
      const id = cell + next.offset;
      if (parents.has(id) || (cell === start && id === previous && columns > 1)) continue;
      parents.set(id, cell);
      queue.push(id);
    }
  }
  throw new Error('Unable to find a route to an active contribution cell.');
}

function sweepOpening(path) {
  const side = 4;
  const start = path[0];
  const exit = start - rows;
  const openingLength = side * side + 2;
  if (start % rows < side - 1 || start < rows * (side - 1) ||
      path.length <= openingLength || path[openingLength - 1] !== exit) {
    return path;
  }

  // Sweep the opening square in alternating columns and rejoin the route at
  // the same exit. Both openings must cover exactly the same cells.
  const sweep = Array.from({ length: side }, (_, column) =>
    Array.from({ length: side }, (_, offset) => {
      const verticalOffset = column % 2 === 0 ? -offset : offset - (side - 1);
      return start - column * rows + verticalOffset;
    }),
  ).flat();
  const original = new Set(path.slice(0, openingLength));
  if (original.size !== sweep.length || sweep.some((cell) => !original.has(cell))) return path;

  return [...sweep, start - 2 * rows, exit, ...path.slice(openingLength)];
}

function buildRoute(activeCells, columns) {
  const food = new Set(activeCells.map(({ id }) => id));
  const start = activeCells.at(-1)?.id ?? (columns - 1) * rows + 3;
  const path = [start];
  food.delete(start);
  while (food.size) {
    for (const cell of findFood(path, food, columns)) {
      path.push(cell);
      food.delete(cell);
    }
  }

  if (path.length === 1) {
    // Give empty or almost empty calendars a visible run as well.
    const column = Math.floor(start / rows);
    const row = start % rows;
    const direction = column >= columns / 2 ? -1 : 1;
    for (let x = column + direction; x >= 0 && x < columns; x += direction) path.push(x * rows + row);
    if (path.length === 1) path.push(row < rows - 1 ? row + 1 : row - 1);
  }
  return sweepOpening(path);
}

function roundCorners(route, center) {
  const positions = route.map(center);
  const firstArrival = new Map([[route[0], 0]]);
  const point = ([x, y]) => `${number(x)} ${number(y)}`;
  const radius = 2.7;
  let length = 0;
  let last = positions[0];
  let path = `M${point(last)}`;

  function lineTo(position) {
    length += Math.hypot(position[0] - last[0], position[1] - last[1]);
    path += `L${point(position)}`;
    last = position;
  }

  for (let index = 1; index < positions.length; index++) {
    const [x, y] = positions[index];
    const [px, py] = positions[index - 1];
    const [nx, ny] = positions[index + 1] ?? [x, y];
    const cross = (x - px) * (ny - y) - (y - py) * (nx - x);
    let arrival;
    if (cross) {
      const entrance = [x - Math.sign(x - px) * radius, y - Math.sign(y - py) * radius];
      const exit = [x + Math.sign(nx - x) * radius, y + Math.sign(ny - y) * radius];
      lineTo(entrance);
      const arcLength = Math.PI * radius / 2;
      arrival = length + arcLength / 2;
      path += `A${radius} ${radius} 0 0 ${Number(cross > 0)} ${point(exit)}`;
      length += arcLength;
      last = exit;
    } else {
      lineTo(positions[index]);
      arrival = length;
    }
    if (!firstArrival.has(route[index])) firstArrival.set(route[index], arrival);
  }
  return { path, length, firstArrival };
}

function render(calendar) {
  const columns = calendar.weeks.length;
  const activeCells = calendar.weeks.flatMap(({ contributionDays }, column) =>
    contributionDays
      .filter(({ contributionCount }) => contributionCount > 0)
      .map(({ weekday, contributionLevel }) => {
        const level = levels.indexOf(contributionLevel);
        if (!Number.isInteger(weekday) || weekday < 0 || weekday >= rows || level < 1) {
          throw new Error('GitHub returned an invalid active contribution day.');
        }
        return { id: column * rows + weekday, level };
      }),
  ).sort((a, b) => a.id - b.id);

  const gridWidth = (columns - 1) * step + cellSize;
  const gridHeight = (rows - 1) * step + cellSize;
  const left = (width - gridWidth) / 2;
  const top = (height - gridHeight) / 2;
  const center = (id) => [
    left + Math.floor(id / rows) * step + cellSize / 2,
    top + (id % rows) * step + cellSize / 2,
  ];
  const route = buildRoute(activeCells, columns);
  const { path, length, firstArrival } = roundCorners(route, center);
  const lead = 0.7;
  const dotDelay = secondsPerCell * 0.66;
  const travel = (length / step) * secondsPerCell;
  const tailEnd = lead + travel + dotCount * dotDelay;
  const fadeOut = tailEnd + 0.45;
  const resetStart = fadeOut + 0.15;
  const duration = resetStart + 0.45;
  const keyTimes = (...times) => times.map((time) => number(time / duration)).join(';');
  const repeat = `dur="${number(duration)}s" repeatCount="indefinite"`;

  function motion(delay) {
    // Every dot travels the same path at the same speed, with a later start.
    return `<animateMotion ${repeat} calcMode="linear" keyPoints="0;0;1;1" keyTimes="${keyTimes(0, lead + delay, lead + delay + travel, duration)}" rotate="0"><mpath href="#route"/></animateMotion>`;
  }

  function cell(id, fill, animation = '') {
    const [x, y] = center(id);
    const box = `x="${number(x - cellSize / 2)}" y="${number(y - cellSize / 2)}" width="${cellSize}" height="${cellSize}" rx="1.8" fill="${fill}"`;
    return animation ? `<rect ${box}>${animation}</rect>` : `<rect ${box}/>`;
  }

  const cells = activeCells.map(({ id, level }) => cell(id, levelColors[level]));
  const eaten = activeCells.map(({ id, level }) => {
    const hit = lead + (firstArrival.get(id) / step) * secondsPerCell;
    const fill = levelColors[level];
    return cell(id, fill, `<animate attributeName="fill" ${repeat} values="${fill};${fill};#9ACDFF;${levelColors[0]};${levelColors[0]};${fill}" keyTimes="${keyTimes(0, hit, hit + 0.07, hit + 0.32, resetStart, duration)}"/>`);
  });
  const dots = Array.from({ length: dotCount }, (_, index) => {
    const fraction = index / Math.max(1, dotCount - 1);
    return `<circle r="${number(2.35 - 1.3 * fraction)}" fill="#58A6FF" opacity="${number(0.78 - 0.60 * fraction)}" filter="url(#dotGlow)">${motion((index + 1) * dotDelay)}</circle>`;
  }).reverse();

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">GitHub contribution snake</title>
  <desc id="description">${calendar.totalContributions} contributions. A glowing blue snake follows the seven-row contribution calendar.</desc>
  <style>@media (prefers-reduced-motion: reduce) { .animation { display: none; } }</style>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#151F2B"/><stop offset=".47" stop-color="#0D1117"/><stop offset="1" stop-color="#0B181F"/>
    </linearGradient>
    <radialGradient id="blue"><stop stop-color="#397CC0" stop-opacity=".36"/><stop offset="1" stop-color="#397CC0" stop-opacity="0"/></radialGradient>
    <radialGradient id="teal"><stop stop-color="#287D83" stop-opacity=".27"/><stop offset="1" stop-color="#287D83" stop-opacity="0"/></radialGradient>
    <radialGradient id="purple"><stop stop-color="#483568" stop-opacity=".62"/><stop offset="1" stop-color="#483568" stop-opacity="0"/></radialGradient>
    <radialGradient id="halo"><stop stop-color="#8EC8FF" stop-opacity=".78"/><stop offset="1" stop-color="#58A6FF" stop-opacity="0"/></radialGradient>
    <filter id="dotGlow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="1.2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#E3F2FF"/><stop offset="1" stop-color="#A8D1FA"/></linearGradient>
    <clipPath id="frame"><rect x="1" y="1" width="698" height="174" rx="17"/></clipPath>
    <pattern id="grid" x="${number(left)}" y="${number(top)}" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
      <rect width="${cellSize}" height="${cellSize}" rx="1.8" fill="${levelColors[0]}"/>
    </pattern>
    <path id="route" d="${path}"/>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="${width}" height="${height}" fill="url(#background)"/>
    <ellipse cx="104" cy="0" rx="194" ry="97" fill="url(#blue)"/>
    <ellipse cx="661" cy="138" rx="190" ry="117" fill="url(#teal)"/>
    <ellipse cx="373" cy="175" rx="224" ry="73" fill="url(#purple)"/>
    <rect x="16" y="17" width="668" height="142" rx="17" fill="#080C12" fill-opacity=".34" stroke="#315779" stroke-opacity=".85"/>
    <rect x="${number(left)}" y="${number(top)}" width="${number(gridWidth)}" height="${number(gridHeight)}" fill="url(#grid)"/>
    <g>${cells.join('\n')}</g>
    <g class="animation">${eaten.join('\n')}</g>
    <g class="animation" opacity="0">
      <animate attributeName="opacity" ${repeat} values="0;1;1;0;0" keyTimes="${keyTimes(0, 0.35, tailEnd, fadeOut, duration)}"/>
      ${dots.join('\n')}
      <g>
        ${motion(0)}
        <circle r="10" fill="url(#halo)" opacity=".85">
          <animate attributeName="opacity" values=".72;.98;.72" dur="2.8s" repeatCount="indefinite"/>
        </circle>
        <rect x="-4.65" y="-4.6" width="9.3" height="9.2" rx="3.65" fill="url(#face)"/>
        <circle cx="-1.65" cy="-.55" r=".86" fill="#10243D"/>
        <circle cx="1.65" cy="-.55" r=".86" fill="#10243D"/>
      </g>
    </g>
  </g>
  <rect x="1" y="1" width="698" height="174" rx="17" fill="none" stroke="#355F84"/>
</svg>
`;
}

try {
  if (!Number.isFinite(secondsPerCell) || secondsPerCell < 0.04 || secondsPerCell > 2 ||
      !Number.isInteger(dotCount) || dotCount < 1 || dotCount > 16) {
    throw new Error('SNAKE_CELL_MS must be 40–2000 and SNAKE_BODY_DOTS must be an integer from 1–16.');
  }
  // An optional calendar JSON snapshot allows a local preview without a token.
  const snapshot = process.argv[2];
  const calendar = snapshot ? JSON.parse(await readFile(snapshot, 'utf8')) : await fetchCalendar();
  if (!Number.isSafeInteger(calendar.totalContributions) || calendar.totalContributions < 0 ||
      !calendar.weeks?.length || calendar.weeks.length > 54) {
    throw new Error('Expected a GitHub contribution calendar with 1–54 weeks.');
  }
  const cards = new URL('../cards/', import.meta.url);
  await mkdir(cards, { recursive: true });
  await writeFile(new URL('contribution-snake.svg', cards), render(calendar));
  console.log(`Generated contribution snake for ${username} (${calendar.totalContributions} contributions).`);
} catch (error) {
  console.error(`generate-snake: ${error.message}`);
  process.exitCode = 1;
}
