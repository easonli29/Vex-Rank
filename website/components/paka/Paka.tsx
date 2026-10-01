'use client';
/**
 * Paka, the site's pixel cat. Sits in the bottom-right corner, naps when the
 * reader goes quiet, comments on the page they open, takes commands ("Ask
 * Paka"), and remembers its name, coat, mood and followed teams in this
 * browser only. Desktop only: index.tsx decides whether this file loads.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { needs, newResults, parseCommand, reactionFor, runCommand, moodAfterPet, moodWord, isStroke, isTripleClick } from './brain.mjs';
import { loadState, saveState, PALETTES, PATTERNS } from './store.mjs';
import { PakaSprite, PixelHeart, PixelPaw, PixelChat, type Eyes } from './sprite';
import { siteFetch } from '@/lib/client-fetch';

type Effect = { type: string; [key: string]: any };
type Action = { label: string; run: Effect };
type Reply = { text: string; actions?: Action[]; effects?: Effect[] };
type Followed = { number: string; matches: number };
type PakaState = {
  name: string;
  coat: { palette: string; pattern: string };
  mood: number;
  pets: number;
  firstSeen: number;
  lastSeen: number;
  hidden: boolean;
  reactions: boolean;
  following: Followed[];
};

export type PakaProps = {
  view: string;
  selectedTeam: any;
  selectedEvent: any;
  teamRows: any[];
  eventRows: any[];
  go: (view: any) => void;
  openTeam: (team: any) => void;
  openEvent: (event: any) => void;
};

const SLEEP_AFTER_MS = 60_000;
const WAKE_DISTANCE_PX = 150;
const REACTION_COOLDOWN_MS = 25_000;
const BUBBLE_MS = 9_000;
const WANDER_RANGE_PX = 260;
const SPEED_PX_PER_S = 70;
const ZOOMIES_PX_PER_S = 520;
const DRAG_THRESHOLD_PX = 6;
const STROKE_WINDOW_MS = 1200;
const SUGGESTIONS = ['55288A', 'compare 1698Z 471B', 'top 5 in ontario', 'next event', 'random'];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

async function loadJson(path: string): Promise<any> {
  const response = await siteFetch(path);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

export default function Paka(props: PakaProps) {
  const [state, setState] = useState<PakaState>(() => loadState() as PakaState);
  // Read once: "days together" doesn't need to tick while the page is open.
  const [openedAt] = useState(() => Date.now());
  const [eyes, setEyes] = useState<Eyes>('open');
  const [tailUp, setTailUp] = useState(false);
  const [asleep, setAsleep] = useState(false);
  const [walking, setWalking] = useState(false);
  const [x, setX] = useState(0);
  const [walkMs, setWalkMs] = useState(0);
  // The sprite faces the reader with its tail on the right; mirrored when
  // walking right so the tail trails behind.
  const [flipped, setFlipped] = useState(false);
  const [lift, setLift] = useState(0);
  const [bubble, setBubble] = useState<Reply | null>(null);
  const [panel, setPanel] = useState(false);
  const [settings, setSettings] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hearts, setHearts] = useState<{ id: number; dx: number }[]>([]);
  // A one-off body animation: a hop for a boop, a purr, held in the air, landing.
  const [move, setMove] = useState<'hop' | 'purr' | 'held' | 'drop' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ownTeams, setOwnTeams] = useState<any[]>([]);
  const [ownEvents, setOwnEvents] = useState<any[]>([]);

  const catRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; startRight: number; moved: boolean } | null>(null);
  const strokes = useRef<{ x: number; t: number }[]>([]);
  const lastPurr = useRef(0);
  const clicks = useRef<number[]>([]);
  const swallowClick = useRef(false);
  const moveTimer = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastActivity = useRef(0);
  const asleepRef = useRef(false);
  const lastBubble = useRef(0);
  const reacted = useRef(new Set<string>());
  const checkedResults = useRef(false);
  const bubbleTimer = useRef<number>(0);

  const teams = props.teamRows?.length ? props.teamRows : ownTeams;
  const events = props.eventRows?.length ? props.eventRows : ownEvents;
  const awake = !asleep;
  useEffect(() => { asleepRef.current = asleep; }, [asleep]);
  const calm = reducedMotion();

  useEffect(() => { saveState(state); }, [state]);
  const update = useCallback((patch: Partial<PakaState>) => setState(current => ({ ...current, ...patch })), []);

  // Speech bubble: one at a time, gone after a few seconds unless it has buttons
  // the reader might still want.
  const say = useCallback((next: Reply, { force = false } = {}) => {
    if (!force && Date.now() - lastBubble.current < REACTION_COOLDOWN_MS) return;
    lastBubble.current = Date.now();
    setBubble(next);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), next.actions?.length ? BUBBLE_MS * 2 : BUBBLE_MS);
  }, []);

  const ensure = useCallback(async (kinds: string[]) => {
    let loadedTeams = teams;
    let loadedEvents = events;
    if (kinds.includes('teams') && !loadedTeams.length) {
      loadedTeams = (await loadJson('/api/rankings?data=v49')).rankings ?? [];
      setOwnTeams(loadedTeams);
    }
    if (kinds.includes('events') && !loadedEvents.length) {
      loadedEvents = (await loadJson('/api/events?season=204&classification=v49')).events ?? [];
      setOwnEvents(loadedEvents);
    }
    return { teams: loadedTeams, events: loadedEvents };
  }, [teams, events]);

  const pet = useCallback((heartCount = 1, happyMs = 900) => {
    lastActivity.current = Date.now();
    setAsleep(false);
    setEyes('happy');
    window.setTimeout(() => setEyes('open'), happyMs);
    if (!calm) {
      // Staggered and spread out, so a purr reads as a stream of hearts.
      for (let index = 0; index < heartCount; index += 1) {
        window.setTimeout(() => {
          const heart = { id: Date.now() + Math.random(), dx: Math.round(rand(-18, 18)) };
          setHearts(list => [...list, heart]);
          window.setTimeout(() => setHearts(list => list.filter(entry => entry.id !== heart.id)), 1200);
        }, index * 260);
      }
    }
    setState(current => ({ ...current, pets: current.pets + 1, mood: moodAfterPet(current.mood) }));
  }, [calm]);

  const animate = useCallback((kind: 'hop' | 'purr' | 'held' | 'drop' | null, ms = 0) => {
    window.clearTimeout(moveTimer.current);
    setMove(calm ? null : kind);
    if (kind && ms) moveTimer.current = window.setTimeout(() => setMove(null), ms);
  }, [calm]);

  // Click: a boop on the nose.
  const boop = useCallback(() => { pet(1); animate('hop', 450); }, [pet, animate]);

  // Stroking back and forth: a long purr.
  const purr = useCallback(() => { pet(4, 1800); animate('purr', 1600); }, [pet, animate]);

  // Triple-click: a dash to the far side of its patch and back.
  const zoomies = useCallback(() => {
    pet(2);
    if (calm) return;
    const start = x;
    const far = start < WANDER_RANGE_PX / 2 ? Math.min(window.innerWidth - 120, 520) : 0;
    const there = Math.abs(far - start) / ZOOMIES_PX_PER_S * 1000;
    const back = Math.abs(far - start) / ZOOMIES_PX_PER_S * 1000;
    setEyes('wide');
    setWalking(true);
    setFlipped(far < start);
    setWalkMs(there);
    setX(far);
    window.setTimeout(() => {
      setFlipped(start < far);
      setWalkMs(back);
      setX(start);
      window.setTimeout(() => { setWalking(false); setEyes('open'); }, back);
    }, there + 120);
  }, [pet, calm, x]);

  const openAsk = useCallback(() => {
    lastActivity.current = Date.now();
    setAsleep(false);
    setBubble(null);
    setSettings(false);
    setPanel(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const closeAsk = useCallback((refocus: boolean) => {
    setPanel(false);
    if (refocus) askRef.current?.focus();
  }, []);

  const perform = useCallback((effect: Effect) => {
    switch (effect.type) {
      case 'openTeam': props.openTeam(effect.team); break;
      case 'openEvent': props.openEvent(effect.event); break;
      case 'go': props.go(effect.view); break;
      case 'pet': pet(); break;
      case 'hide': setPanel(false); setBubble(null); update({ hidden: true }); break;
      case 'rename': update({ name: effect.name }); break;
      case 'theme':
        document.documentElement.dataset.theme = effect.theme;
        try { localStorage.setItem('vexrank-theme', effect.theme); } catch { /* the theme lasts the visit */ }
        // The theme picker owns its own state; this keeps its label in step.
        window.dispatchEvent(new CustomEvent('vexrank-theme', { detail: effect.theme }));
        break;
      case 'follow':
        setState(current => ({ ...current, following: [...current.following.filter(entry => entry.number !== effect.number), { number: effect.number, matches: effect.matches }] }));
        break;
      case 'unfollow':
        setState(current => ({ ...current, following: current.following.filter(entry => entry.number !== effect.number) }));
        break;
    }
  }, [props, pet, update]);

  const ask = useCallback(async (text: string) => {
    const command = parseCommand(text);
    setBusy(true);
    setEyes('wide');
    try {
      const data = await ensure(needs(command));
      const result: Reply = runCommand(command, { ...data, following: state.following, name: state.name });
      setReply(result);
      result.effects?.forEach(perform);
    } catch {
      setReply({ text: 'Mrrp. I couldn\'t reach the data just now. Try again in a moment.' });
    } finally {
      setBusy(false);
      setEyes('open');
    }
  }, [ensure, perform, state.following, state.name]);

  const runAction = useCallback((effect: Effect) => {
    if (effect.type === 'command') { lastActivity.current = Date.now(); setAsleep(false); setPanel(true); setInput(effect.text); void ask(effect.text); return; }
    perform(effect);
    setBubble(null);
  }, [ask, perform]);

  // Idle → nap; any activity resets the clock, and the pointer coming close
  // wakes the cat.
  useEffect(() => {
    lastActivity.current = Date.now();
    const onActivity = (event: Event) => {
      lastActivity.current = Date.now();
      if (event.type !== 'pointermove' || !catRef.current) return;
      const box = catRef.current.getBoundingClientRect();
      const { clientX, clientY } = event as PointerEvent;
      const distance = Math.hypot(clientX - (box.left + box.width / 2), clientY - (box.top + box.height / 2));
      if (distance < WAKE_DISTANCE_PX && asleepRef.current) {
        setAsleep(false);
        setEyes('wide');
        window.setTimeout(() => setEyes('open'), 1200);
      }
    };
    const events = ['pointermove', 'keydown', 'scroll', 'pointerdown'];
    events.forEach(name => window.addEventListener(name, onActivity, { passive: true }));
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current > SLEEP_AFTER_MS) setAsleep(true);
    }, 5000);
    return () => { events.forEach(name => window.removeEventListener(name, onActivity)); window.clearInterval(timer); };
  }, []);

  // Blinks and tail flicks. Skipped entirely for reduced motion.
  useEffect(() => {
    if (calm || asleep) return;
    let blink = 0; let tail = 0; let reset = 0;
    const scheduleBlink = () => { blink = window.setTimeout(() => {
      setEyes(current => current === 'open' ? 'closed' : current);
      reset = window.setTimeout(() => setEyes(current => current === 'closed' ? 'open' : current), 140);
      scheduleBlink();
    }, rand(2500, 6000)); };
    const scheduleTail = () => { tail = window.setTimeout(() => {
      setTailUp(true);
      window.setTimeout(() => setTailUp(false), 450);
      scheduleTail();
    }, rand(3500, 8000)); };
    scheduleBlink(); scheduleTail();
    return () => { window.clearTimeout(blink); window.clearTimeout(tail); window.clearTimeout(reset); };
  }, [calm, asleep]);

  // A stroll along the bottom edge now and then, when nothing else is going on.
  useEffect(() => {
    if (calm || asleep || panel || bubble || dragging || walking) return;
    const timer = window.setTimeout(() => {
      const target = Math.round(rand(0, WANDER_RANGE_PX));
      const ms = Math.abs(target - x) / SPEED_PX_PER_S * 1000;
      if (ms < 300) return;
      // `right` growing moves the cat left, which needs no mirroring.
      setFlipped(target < x);
      setWalkMs(ms);
      setWalking(true);
      setX(target);
      window.setTimeout(() => setWalking(false), ms);
    }, rand(20_000, 40_000));
    return () => window.clearTimeout(timer);
  }, [calm, asleep, panel, bubble, dragging, walking, x]);

  // Climb above the footer rather than sit on the disclaimer.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const footer = document.querySelector('footer');
      const top = footer?.getBoundingClientRect().top ?? Infinity;
      setLift(Math.max(0, window.innerHeight - top));
    };
    const onChange = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onChange, { passive: true });
    window.addEventListener('resize', onChange);
    return () => { window.removeEventListener('scroll', onChange); window.removeEventListener('resize', onChange); cancelAnimationFrame(frame); };
  }, []);

  // A word about the page the reader just opened, once per page per visit.
  useEffect(() => {
    if (state.hidden || !state.reactions || panel) return;
    const key = `${props.view}:${props.selectedTeam?.number ?? ''}:${props.selectedEvent?.id ?? ''}`;
    if (reacted.current.has(key)) return;
    const timer = window.setTimeout(async () => {
      let data = { teams, events };
      if (props.view === 'team') { try { data = await ensure(['teams']); } catch { /* say nothing */ } }
      const reaction = reactionFor({ view: props.view, selectedTeam: props.selectedTeam, selectedEvent: props.selectedEvent, ...data, following: state.following, name: state.name });
      if (!reaction) return;
      reacted.current.add(key);
      setAsleep(false);
      say(reaction);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [props.view, props.selectedTeam, props.selectedEvent, teams, events, ensure, say, state.hidden, state.reactions, state.name, state.following, panel]);

  // Followed teams that played since last visit: say so once, then remember.
  useEffect(() => {
    if (checkedResults.current || !teams.length || !state.following.length) return;
    const fresh: { number: string; played: number; matches: number }[] = newResults(state.following, teams);
    if (!fresh.length) { checkedResults.current = true; return; }
    // A frame later, so the effect itself only reads (see the react-compiler
    // rule). Marked checked inside, so a cancelled frame is retried, not lost.
    const frame = requestAnimationFrame(() => {
      checkedResults.current = true;
      setState(current => ({ ...current, following: current.following.map(entry => {
        const seen = fresh.find(item => item.number === entry.number);
        return seen ? { ...entry, matches: seen.matches } : entry;
      }) }));
      say({
        text: fresh.length === 1
          ? `${fresh[0].number} played ${fresh[0].played} new match${fresh[0].played === 1 ? '' : 'es'} since your last visit!`
          : `${fresh.length} of your teams have new results since your last visit!`,
        actions: fresh.slice(0, 4).map(item => ({ label: item.number, run: { type: 'openTeam', team: { number: item.number, name: '' } } })),
      }, { force: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [teams, state.following, say]);

  // Esc closes the panel and hands focus back to the cat.
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeAsk(true); };
    // A press anywhere outside Paka (panel, cat and buttons) closes the box.
    // Focus is left where the reader clicked rather than pulled back.
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeAsk(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer, true); };
  }, [panel, closeAsk]);

  const days = Math.max(1, Math.ceil((openedAt - state.firstSeen) / 86_400_000));

  if (state.hidden) {
    return <button onClick={() => update({ hidden: false })} aria-label={`Show ${state.name}`} title={`Show ${state.name}`}
      className="fixed bottom-4 right-4 z-40 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[var(--c-surface)] text-white/35 transition hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"
      style={{ bottom: 16 + lift }}>
      <PixelPaw />
    </button>;
  }

  const shownEyes: Eyes = asleep ? 'closed' : eyes;

  // Pointer handling on the cat itself: press and drag to carry it, stroke to
  // make it purr, click to boop, three quick clicks for zoomies.
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    press.current = { x: event.clientX, startRight: x, moved: false };
    // Keeps the drag going if the pointer outruns the cat. Can throw for a
    // pointer that is already gone; the drag then simply ends on release.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* see above */ }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const held = press.current;
    if (held) {
      const dx = event.clientX - held.x;
      if (!held.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        held.moved = true;
        setDragging(true);
        setAsleep(false);
        setEyes('wide');
        setWalkMs(0);
        animate('held');
      }
      if (held.moved) {
        setFlipped(dx > 0);
        setX(Math.max(0, Math.min(window.innerWidth - 100, held.startRight - dx)));
      }
      return;
    }
    const now = Date.now();
    strokes.current = [...strokes.current.filter(sample => now - sample.t < STROKE_WINDOW_MS), { x: event.clientX, t: now }];
    if (now - lastPurr.current > 2500 && isStroke(strokes.current.map(sample => sample.x))) {
      lastPurr.current = now;
      strokes.current = [];
      purr();
    }
  };
  const onPointerUp = () => {
    const held = press.current;
    press.current = null;
    if (!held?.moved) return;
    swallowClick.current = true;
    setDragging(false);
    setEyes('open');
    animate('drop', 320);
  };
  const onClick = () => {
    // A drop ends with a click event too; that one isn't a boop.
    if (swallowClick.current) { swallowClick.current = false; return; }
    const now = Date.now();
    clicks.current = [...clicks.current.filter(time => now - time < 1000), now];
    if (isTripleClick(clicks.current, now)) { clicks.current = []; zoomies(); } else boop();
  };

  return <div ref={rootRef} className="paka fixed z-40 select-none" style={{ right: 20 + x, bottom: 12 + lift, transition: `right ${walkMs}ms linear, bottom 200ms ease-out` }}>
    {/* Speech bubble */}
    {bubble && !panel && <output aria-live="polite" className="paka-box absolute bottom-full right-0 mb-2 block w-72">
      <p className="whitespace-pre-line text-[13px] leading-snug text-white/85">{bubble.text}</p>
      {!!bubble.actions?.length && <div className="mt-2 flex flex-wrap gap-1.5">{bubble.actions.map(action =>
        <button key={action.label} onClick={() => runAction(action.run)} className="paka-chip">{action.label}</button>)}</div>}
      <button onClick={() => setBubble(null)} aria-label="Dismiss" className="absolute right-1.5 top-1 text-xs text-white/35 hover:text-white">×</button>
    </output>}

    {/* Ask panel */}
    {/* Non-modal: the page stays usable while the panel is open. */}
    {panel && <dialog open aria-label={`Ask ${state.name}`} className="paka-box paka-panel absolute bottom-full right-0 mb-2 w-80 text-white">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">{settings ? `${state.name}'s card` : `Ask ${state.name}`}</span>
        <span className="flex gap-2">
          <button onClick={() => setSettings(value => !value)} className="text-xs text-white/45 hover:text-white">{settings ? 'Back' : 'Settings'}</button>
          <button onClick={() => closeAsk(true)} aria-label="Close" className="text-sm leading-none text-white/45 hover:text-white">×</button>
        </span>
      </div>

      {!settings && <>
        <form onSubmit={event => { event.preventDefault(); if (input.trim()) void ask(input); }}>
          <input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder="Team number, or try “help”"
            aria-label={`Ask ${state.name}`} className="w-full rounded-md border border-white/15 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-[var(--c-accent)] focus:outline-none" />
        </form>
        <div aria-live="polite" className="mt-2.5 min-h-6">
          {busy && <p className="text-[13px] text-white/50">*sniffs around*…</p>}
          {!busy && reply && <>
            <p className="whitespace-pre-line text-[13px] leading-snug text-white/85">{reply.text}</p>
            {!!reply.actions?.length && <div className="mt-2 flex flex-wrap gap-1.5">{reply.actions.map(action =>
              <button key={action.label} onClick={() => runAction(action.run)} className="paka-chip">{action.label}</button>)}</div>}
          </>}
          {!busy && !reply && <div className="flex flex-wrap gap-1.5">{SUGGESTIONS.map(text =>
            <button key={text} onClick={() => { setInput(text); void ask(text); }} className="paka-chip">{text}</button>)}</div>}
        </div>
      </>}

      {settings && <div className="space-y-3 text-[13px] text-white/80">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-black/30 p-1"><PakaSprite coat={state.coat} eyes="open" tailUp={false} size={48} /></div>
          <div className="min-w-0 flex-1">
            <label className="block text-[11px] uppercase tracking-wider text-white/40" htmlFor="paka-name">Name</label>
            <input id="paka-name" value={state.name} maxLength={20} onChange={event => update({ name: event.target.value.slice(0, 20) })}
              onBlur={event => { if (!event.target.value.trim()) update({ name: 'Paka' }); }}
              className="w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-sm text-white focus:border-[var(--c-accent)] focus:outline-none" />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div><dt className="text-[11px] text-white/40">Mood</dt><dd className="font-semibold">{moodWord(state.mood)}</dd></div>
          <div><dt className="text-[11px] text-white/40">Pets</dt><dd className="font-semibold">{state.pets}</dd></div>
          <div><dt className="text-[11px] text-white/40">Together</dt><dd className="font-semibold">{days} day{days === 1 ? '' : 's'}</dd></div>
        </dl>
        <progress className="paka-mood" value={state.mood} max={100} aria-label="Mood" />
        <div className="flex flex-wrap gap-1.5">
          <button className="paka-chip" onClick={() => update({ coat: { palette: PALETTES[Math.floor(Math.random() * PALETTES.length)], pattern: PATTERNS[Math.floor(Math.random() * PATTERNS.length)] } })}>New coat</button>
          <button className="paka-chip" onClick={() => update({ reactions: !state.reactions })}>{state.reactions ? 'Mute comments' : 'Allow comments'}</button>
          <button className="paka-chip" onClick={() => perform({ type: 'hide' })}>Hide {state.name}</button>
        </div>
        <p className="text-[11px] leading-snug text-white/35">Everything about {state.name} stays in this browser.</p>
      </div>}
    </dialog>}

    {/* Hearts and Zzz */}
    {hearts.map(heart => <span key={heart.id} className="paka-heart pointer-events-none absolute top-0" style={{ left: `calc(50% + ${heart.dx}px)` }}><PixelHeart /></span>)}
    {asleep && <span aria-hidden="true" className="paka-z pointer-events-none absolute -top-2 right-0 font-mono text-xs font-bold text-white/60">z<span className="text-[10px]">z</span></span>}

    {/* Ask: the one way into the panel, so playing with the cat never opens it. */}
    <button ref={askRef} onClick={() => panel ? closeAsk(false) : openAsk()} aria-expanded={panel} aria-haspopup="dialog"
      aria-label={`Ask ${state.name}`} title={`Ask ${state.name}`}
      className={`paka-ask absolute -left-7 top-0 grid h-7 w-7 place-items-center text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${panel ? 'paka-ask-open' : ''}`}>
      <PixelChat />
    </button>

    {/* The cat */}
    <button ref={catRef} onClick={onClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      aria-label={`${state.name}, your cat${asleep ? ' (napping)' : ''}. Click to boop, click three times for zoomies.`}
      title={asleep ? `${state.name} is napping` : `Boop, stroke or drag ${state.name}`}
      className={`paka-cat block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${walking ? 'paka-walk' : ''} ${asleep ? 'paka-asleep' : ''} ${move ? `paka-${move}` : ''} ${dragging ? 'paka-dragging' : ''}`}
      style={{ transform: flipped ? 'scaleX(-1)' : undefined }}>
      <PakaSprite coat={state.coat} eyes={shownEyes} tailUp={awake && tailUp} />
    </button>
  </div>;
}
