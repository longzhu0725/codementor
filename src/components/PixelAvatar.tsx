'use client';

/**
 * PixelAvatar — inline-SVG pixel-art mascots for CodeMentor.
 *
 * Each mascot is a 16x16 grid of single-char cells. A palette maps each
 * char to a hex color. "." = transparent. The grid is rendered as a set
 * of <rect> "pixels" inside a 16x16 viewBox SVG, scaled by the `size` prop.
 *
 * The mascots share a "slime blob" silhouette for cohesion, but each agent
 * role has distinct colors + accessories (antenna, cap, ears, horns, visor,
 * headband) so they're instantly recognizable and fun.
 */

export type MascotRole =
  | 'orchestrator'
  | 'lecturer'
  | 'problem_setter'
  | 'examiner'
  | 'path_planner'
  | 'user'
  | 'logo';

type Palette = Record<string, string>;

interface Mascot {
  grid: string[];
  palette: Palette;
}

// Palette tokens (shared meaning across mascots):
//  . transparent | # outline | a main | b border/shade | c highlight
//  w white | e eye/accent-dark | f feature/accent | g secondary feature

const ROBOT: Mascot = {
  // Orchestrator — indigo slime robot with antenna + glowing visor
  grid: [
    '.......##.......',
    '.......##.......',
    '....########....',
    '...#aaaaaaaa#...',
    '..#aabbbbbbba#..',
    '..#abccccccba#..',
    '..#abeeeeeeba#..',
    '..#abewwwwwba#..',
    '..#abccccccba#..',
    '..#abccfffccba#.',
    '..#aabbbbbbba#..',
    '...#aaaaaaaa#...',
    '....########....',
    '................',
    '................',
    '................',
  ],
  palette: {
    '#': '#1e1b4b',
    a: '#818cf8',
    b: '#6366f1',
    c: '#c7d2fe',
    w: '#ffffff',
    e: '#22d3ee',
    f: '#a5b4fc',
  },
};

const OWL: Mascot = {
  // Lecturer — emerald owl slime with graduation cap + big eyes + beak
  grid: [
    '....########....',
    '...#ffffffff#...',
    '..#ffffffffff#..',
    '...#aaaaaaaa#...',
    '..#aabbbbbbba#..',
    '..#abwwbbbbwwba#',
    '..#abwebbbbebwa#',
    '..#abwwbbbbwwba#',
    '..#abmmmffmmmba#',
    '..#abccccccba#..',
    '..#aabbbbbbba#..',
    '...#aaaaaaaa#...',
    '....########....',
    '................',
    '................',
    '................',
  ],
  palette: {
    '#': '#064e3b',
    a: '#34d399',
    b: '#059669',
    c: '#6ee7b7',
    w: '#ffffff',
    e: '#064e3b',
    f: '#fbbf24',
    m: '#34d399',
  },
};

const CAT: Mascot = {
  // Problem Setter — amber cat slime with pointy ears
  grid: [
    '..##........##..',
    '.#bb########bb#.',
    '...#aaaaaaaa#...',
    '..#aabbbbbbba#..',
    '..#abccccccba#..',
    '..#abwwbbwwba#..',
    '..#abwebbbebwa#.',
    '..#abwwbbwwba#..',
    '..#abccccccba#..',
    '..#abccfffccba#.',
    '..#aabbbbbbba#..',
    '...#aaaaaaaa#...',
    '....########....',
    '................',
    '................',
    '................',
  ],
  palette: {
    '#': '#78350f',
    a: '#fbbf24',
    b: '#d97706',
    c: '#fde68a',
    w: '#ffffff',
    e: '#78350f',
    f: '#f97316',
  },
};

const DRAGON: Mascot = {
  // Examiner — red dragon slime with horns + fiery eyes
  grid: [
    '.#............#.',
    '.##..........##.',
    '..####....####..',
    '...#aaaaaaaa#...',
    '..#aabbbbbbba#..',
    '..#abccccccba#..',
    '..#abeebbbeeba#.',
    '..#abewebbbewba#',
    '..#abccccccba#..',
    '..#abccfffccba#.',
    '..#aabbbbbbba#..',
    '...#aaaaaaaa#...',
    '....########....',
    '................',
    '................',
    '................',
  ],
  palette: {
    '#': '#7f1d1d',
    a: '#f87171',
    b: '#dc2626',
    c: '#fca5a5',
    w: '#ffffff',
    e: '#fb923c',
    f: '#fde68a',
  },
};

const FOX: Mascot = {
  // Path Planner — orange fox slime with ears + compass spark
  grid: [
    '..##........##..',
    '.#bb########bb#.',
    '...#aaaaaaaa#...',
    '..#aabbbbbbba#..',
    '..#abccccccba#..',
    '..#abwwbbwwba#..',
    '..#abwebbbebwa#.',
    '..#abwwbbwwba#..',
    '..#abccccccba#..',
    '..#abccgffccba#.',
    '..#aabbbbbbba#..',
    '...#aaaaaaaa#...',
    '....########....',
    '................',
    '................',
    '................',
  ],
  palette: {
    '#': '#7c2d12',
    a: '#fb923c',
    b: '#c2410c',
    c: '#fed7aa',
    w: '#ffffff',
    e: '#7c2d12',
    f: '#38bdf8',
    g: '#7dd3fc',
  },
};

const HERO: Mascot = {
  // User — violet hero slime with headband + determined eyes
  grid: [
    '................',
    '....########....',
    '...#ffffffff#...',
    '..#ffaaaaaaff#..',
    '..#aabbbbbbba#..',
    '..#abwwbbwwba#..',
    '..#abwebbbebwa#.',
    '..#abwwbbwwba#..',
    '..#abccccccba#..',
    '..#abccfffccba#.',
    '..#aabbbbbbba#..',
    '...#aaaaaaaa#...',
    '....########....',
    '................',
    '................',
    '................',
  ],
  palette: {
    '#': '#4c1d95',
    a: '#a78bfa',
    b: '#7c3aed',
    c: '#c4b5fd',
    w: '#ffffff',
    e: '#4c1d95',
    f: '#f472b6',
  },
};

const LOGO: Mascot = {
  // Logo — a pixel code-bracket sprite in accent colors
  grid: [
    '................',
    '...##......##...',
    '..#aa#....#aa#..',
    '.#aaaa#..#aaaa#.',
    '.#aaaaa##aaaaa#.',
    '.#aaaaaaaaaaaa#.',
    '..#aaaaaaaaaa#..',
    '...#aaaaaaaa#...',
    '....#aaaaaa#....',
    '...#aaaaaaaa#...',
    '..#aaaaaaaaaa#..',
    '.#aaaaaaaaaaaa#.',
    '.#aaaaa##aaaaa#.',
    '.#aaaa#..#aaaa#.',
    '..#aa#....#aa#..',
    '...##......##...',
  ],
  palette: {
    '#': '#0f172a',
    a: '#6366f1',
  },
};

const MASCOTS: Record<MascotRole, Mascot> = {
  orchestrator: ROBOT,
  lecturer: OWL,
  problem_setter: CAT,
  examiner: DRAGON,
  path_planner: FOX,
  user: HERO,
  logo: LOGO,
};

export interface PixelAvatarProps {
  role: MascotRole;
  size?: number;
  className?: string;
  /** Add a gentle floating animation. */
  floating?: boolean;
}

export function PixelAvatar({
  role,
  size = 36,
  className = '',
  floating = false,
}: PixelAvatarProps) {
  const mascot = MASCOTS[role] ?? ROBOT;
  const cells: React.ReactNode[] = [];

  for (let y = 0; y < mascot.grid.length; y++) {
    const row = mascot.grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const color = mascot.palette[ch];
      if (!color) continue;
      cells.push(
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={1.02}
          height={1.02}
          fill={color}
        />
      );
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={`pixel-avatar ${floating ? 'pixel-avatar-float' : ''} ${className}`}
      role="img"
      aria-hidden="true"
    >
      {cells}
    </svg>
  );
}

/** Blocky pixel-art star used for difficulty rating (1-5). */
const STAR_PIXELS = [
  '......####......',
  '......####......',
  '################',
  '################',
  '.##############.',
  '..############..',
  '...##########...',
  '....########....',
  '...##.##.##.....',
  '..##..##..##....',
  '..#...##...#....',
  '......##........',
  '................',
  '................',
  '................',
  '................',
];

export function PixelStars({
  count,
  size = 12,
}: {
  count: number;
  size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${count} 星`}>
      {Array.from({ length: 5 }, (_, i) => {
        const active = i < count;
        return (
          <svg
            key={i}
            width={size}
            height={size}
            viewBox="0 0 16 16"
            shapeRendering="crispEdges"
            className="pixel-star"
            style={{ opacity: active ? 1 : 0.18 }}
          >
            {STAR_PIXELS.map((row, y) =>
              row.split('').map((ch, x) =>
                ch === '#' ? (
                  <rect
                    key={`${x}-${y}`}
                    x={x}
                    y={y}
                    width={1.02}
                    height={1.02}
                    fill={active ? '#fbbf24' : '#64748b'}
                  />
                ) : null
              )
            )}
          </svg>
        );
      })}
    </span>
  );
}
