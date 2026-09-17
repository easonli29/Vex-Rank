'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';

/* Paths render solid until the dash properties are applied, so this has to run
   before paint or the finished number flashes for a frame. useLayoutEffect has
   no server equivalent, hence the guard. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;
import { strokesFor, canDraw, GLYPH_ADVANCE, GLYPH_HEIGHT } from '@/lib/stroke-glyphs.mjs';

/**
 * Draws a team number the way a person writes it: one stroke at a time, in
 * order, at a constant pen speed.
 *
 * Each stroke is traced with stroke-dashoffset. Duration is proportional to the
 * stroke's own length, so a long diagonal takes longer than a short crossbar -
 * a fixed duration per stroke is what makes this kind of animation read as
 * mechanical rather than handwritten.
 */
export default function SignedNumber({ value, accentFrom, className = '' }: { value: string; accentFrom?: number; className?: string }) {
  const root = useRef<SVGSVGElement | null>(null);
  const text = String(value ?? '');

  useBeforePaint(() => {
    const svg = root.current;
    if (!svg) return;
    const paths = [...svg.querySelectorAll('path')];
    if (!paths.length) return;

    // Reduced motion: leave it fully written rather than animating or hiding.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      paths.forEach(path => { path.style.strokeDasharray = 'none'; path.style.strokeDashoffset = '0'; });
      return;
    }

    const PEN_SPEED = 0.62;   // ms per user unit
    const PEN_LIFT = 55;      // pause between strokes, as the hand repositions
    const animations: Animation[] = [];
    let at = 180;             // let the profile header settle first

    for (const path of paths) {
      const length = path.getTotalLength();
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      const duration = Math.max(90, length * PEN_SPEED);
      animations.push(path.animate(
        [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
        { duration, delay: at, easing: 'cubic-bezier(0.4, 0, 0.5, 1)', fill: 'both' },
      ));
      at += duration + PEN_LIFT;
    }
    return () => animations.forEach(animation => animation.cancel());
  }, [text]);

  // Anything outside the glyph set (unexpected punctuation) falls back to text
  // rather than rendering a gap.
  if (!canDraw(text)) return <span className={className}>{text}</span>;

  const characters = Array.from(text);
  const width = characters.length * GLYPH_ADVANCE;
  return (
    <svg
      ref={root}
      className={className}
      viewBox={`-6 -6 ${width + 12} ${GLYPH_HEIGHT + 24}`}
      aria-hidden="true"
      preserveAspectRatio="xMinYMid meet"
      style={{ overflow: 'visible' }}
    >
      {characters.map((character, index) => (
        <g key={`${character}-${index}`} transform={`translate(${index * GLYPH_ADVANCE} 0)`}>
          {(strokesFor(character) as string[]).map((d, stroke) => (
            <path
              key={stroke}
              d={d}
              fill="none"
              stroke={accentFrom !== undefined && index >= accentFrom ? 'var(--c-accent)' : 'currentColor'}
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
      ))}
    </svg>
  );
}
