'use client';

/**
 * Daily Ranked board.
 *
 * Placements are applied locally with the shared ranked rules for instant
 * feedback, then sent to the server once the tray is used up (or no piece
 * fits). The server recomputes everything, deals the next tray and is the
 * only source of the score; if it disagrees, the board resyncs to it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RANKED_SALES_OPEN } from '@/lib/ranked/config';
import Link from 'next/link';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { BOARD_COLS, BOARD_ROWS, CELL_GAP, CELL_SIZE, COLOR_POOL, type BlockColor, type Cell } from '@/lib/game/constants';
import {
  createParticlesForClear, drawBoard, drawGhostPiece, drawParticles, drawScorePop, drawTrayPiece,
  roundRect, updateParticles, type Particle,
} from '@/lib/game/renderer';
import {
  applyMove, boardFromHex, fits, isFilled, PIECES, trayEmpty, type Move, type RankedState,
} from '@/lib/ranked/rules';
import { RankedApiError, RankedClient, type Me } from '@/lib/ranked/client';
import { useT } from '@/lib/i18n';
import { PlayerAvatar, useMyAvatar } from '@/components/CssAvatars';
import { translatePop } from './popLabel';
import { RANKED, RANKED_VARS } from './rankedFacts';
import { useNumber } from './useNumber';
import { playSfx } from '@/lib/audio';
import styles from './GameCanvas.module.css';
import rs from './Ranked.module.css';

const BOARD_PX = BOARD_COLS * (CELL_SIZE + CELL_GAP) - CELL_GAP;
const ORIGIN = 12;
const TRAY_Y = ORIGIN + BOARD_PX + 40;
const CANVAS_W = BOARD_PX + 24;
const CANVAS_H = TRAY_Y + 130;
const TRAY_CELL = 28;

type Pop = { id: number; label: string; points: number; start: number };

/** Time until the next UTC midnight, ticking once a second (null until mounted). */
function useUtcCountdown() {
  const [left, setLeft] = useState<{ h: number; m: number; s: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(0, 0, 0, 0);
      const ms = tomorrow.getTime() - now.getTime();
      setLeft({ h: Math.floor(ms / 3600000), m: Math.floor((ms % 3600000) / 60000), s: Math.floor((ms % 60000) / 1000) });
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);
  return left;
}

/** Card with a real BlockBite mascot peeking over its top edge. */
function MascotCard({ alt, children }: { alt: string; children: React.ReactNode }) {
  return (
    <div className={rs.stage}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mascots/mascot-rex.png" alt={alt} width={112} height={112} className={rs.mascot} />
      <div className={rs.card}>{children}</div>
    </div>
  );
}

/** Who is playing: avatar (from /api/profile/avatar via useMyAvatar), short wallet, link to change it. */
function PlayerRow({ avatarId, wallet, t }: { avatarId: string; wallet: string; t: (k: string) => string }) {
  return (
    <div className={rs.player}>
      <PlayerAvatar id={avatarId} size={44} label={t('your_avatar')} />
      <div className={rs.playerText}>
        <span className={rs.statLabel}>{t('playing_as')}</span>
        <code className={rs.playerWallet} title={wallet}>{wallet.slice(0, 4)}…{wallet.slice(-4)}</code>
      </div>
      <Link href="/profile" className={rs.playerLink}>{t('change_avatar')}</Link>
    </div>
  );
}

function colorOf(piece: number, move: number): BlockColor {
  return COLOR_POOL[(piece * 3 + move) % COLOR_POOL.length];
}

/** Colours are cosmetic; after a resync, filled cells get a stable colour by position. */
function colorsFromBoard(boardHex: string): (BlockColor | null)[] {
  const b = boardFromHex(boardHex);
  return Array.from({ length: 64 }, (_, i) => (isFilled(b, Math.floor(i / 8), i % 8) ? COLOR_POOL[(i * 5) % COLOR_POOL.length] : null));
}

export default function RankedCanvas() {
  const { publicKey, connected, connecting, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const wallet = publicKey?.toBase58() ?? null;
  const t = useT('ranked');
  const tg = useT('game');
  const countdown = useUtcCountdown();
  const avatarId = useMyAvatar();
  const { score: formatScore } = useNumber();

  const [client, setClient] = useState<RankedClient | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [runId, setRunId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [server, setServer] = useState<RankedState | null>(null);
  const [pending, setPending] = useState<Move[]>([]);
  const [colors, setColors] = useState<(BlockColor | null)[]>(Array(64).fill(null));
  const [selected, setSelected] = useState<0 | 1 | 2 | null>(null);
  const [ghost, setGhost] = useState<{ row: number; col: number } | null>(null);
  const [closedMsg, setClosedMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const pops = useRef<Pop[]>([]);
  const popId = useRef(0);

  // Local view = last server state + placements not yet sent.
  const local = useMemo(() => {
    if (!server) return null;
    let s = server;
    for (const m of pending) s = applyMove(s, m).state;
    return s;
  }, [server, pending]);

  // Session: reuse this tab's sign-in if there is one.
  useEffect(() => {
    setClient(wallet ? RankedClient.cached(wallet) : null);
    setMe(null);
    setRunId(null);
    setServer(null);
    setPending([]);
  }, [wallet]);

  const refreshMe = useCallback(async (c: RankedClient) => {
    try {
      setMe(await c.me());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (client) refreshMe(client);
  }, [client, refreshMe]);

  const signIn = async () => {
    if (!wallet || !signMessage) {
      setError(t('cannot_sign'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setClient(await RankedClient.connect(wallet, signMessage));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadRun = (id: string, n: number, state: RankedState) => {
    setRunId(id);
    setAttempt(n);
    setServer(state);
    setPending([]);
    setColors(colorsFromBoard(state.board));
    setSelected(null);
    setClosedMsg(null);
  };

  const start = async () => {
    if (!client) return;
    setError(null);
    setBusy(true);
    try {
      const r = await client.start();
      loadRun(r.runId, r.attempt, r.state);
      refreshMe(client);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resume = async (id: string) => {
    if (!client) return;
    setBusy(true);
    try {
      const r = await client.run(id);
      loadRun(r.runId, r.attempt, r.state);
      if (r.closed && !r.state.over) setClosedMsg(t('day_ended'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Send the finished tray (or the last moves before getting stuck).
  useEffect(() => {
    if (!client || !runId || !server || !local || busy || pending.length === 0) return;
    if (!trayEmpty(local.tray) && !local.over) return;
    setBusy(true);
    client.play(runId, server.moves, pending)
      .then((r) => {
        setServer(r.state);
        setPending([]);
        if (r.state.over) refreshMe(client);
      })
      .catch((e) => {
        if (e instanceof RankedApiError && e.state) {
          setServer(e.state);
          setPending([]);
          setColors(colorsFromBoard(e.state.board));
          if (e.status === 409 && /day has ended/.test(e.message)) setClosedMsg(t('day_ended'));
          else setError(t('resynced', { msg: e.message }));
        } else {
          setError(t('offline', { msg: e instanceof Error ? e.message : '' }));
        }
      })
      .finally(() => setBusy(false));
  }, [client, runId, server, local, busy, pending, refreshMe]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = (slot: 0 | 1 | 2, row: number, col: number) => {
    if (!local || local.over || busy || closedMsg) return;
    const piece = local.tray[slot];
    if (piece === null) return;
    const p = PIECES[piece];
    row = Math.max(0, Math.min(row, BOARD_ROWS - p.rows));
    col = Math.max(0, Math.min(col, BOARD_COLS - p.cols));
    if (!fits(boardFromHex(local.board), piece, row, col)) return;
    const r = applyMove(local, { slot, row, col });
    const c = [...colors];
    for (const [dr, dc] of p.cells) c[(row + dr) * 8 + (col + dc)] = colorOf(piece, local.moves);
    for (const rr of r.rows) for (let k = 0; k < 8; k++) c[rr * 8 + k] = null;
    for (const cc of r.cols) for (let k = 0; k < 8; k++) c[k * 8 + cc] = null;
    setColors(c);
    const cleared = r.rows.length + r.cols.length;
    if (cleared === 0) playSfx('place');
    else if (/^0+$/.test(r.state.board)) playSfx('perfect');
    else if (r.state.chain > 1) playSfx('combo', r.state.chain);
    else playSfx('line');
    if (cleared > 0) {
      particles.current.push(...createParticlesForClear(r.rows, r.cols, ORIGIN, ORIGIN));
    }
    if (r.points > 0 && r.label) pops.current.push({ id: ++popId.current, label: r.label, points: r.points, start: Date.now() });
    setPending((q) => [...q, { slot, row, col }]);
    setSelected(null);
    setGhost(null);
  };

  // Game-over sound once per run.
  const overRef = useRef(false);
  useEffect(() => {
    const over = !!local?.over;
    if (over && !overRef.current) playSfx('gameover');
    overRef.current = over;
  }, [local?.over]);

  // ── Canvas ───────────────────────────────────────────────────────
  const pos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * CANVAS_W) / rect.width,
      y: ((e.clientY - rect.top) * CANVAS_H) / rect.height,
    };
  };
  const cellAt = (x: number, y: number) => {
    const t = CELL_SIZE + CELL_GAP;
    const col = Math.floor((x - ORIGIN) / t);
    const row = Math.floor((y - ORIGIN) / t);
    return row >= 0 && row < 8 && col >= 0 && col < 8 ? { row, col } : null;
  };
  const slotAt = (x: number, y: number): 0 | 1 | 2 | null => {
    if (y < TRAY_Y - 40 || y > TRAY_Y + 120) return null;
    const i = Math.floor(x / (CANVAS_W / 3));
    return i >= 0 && i <= 2 ? (i as 0 | 1 | 2) : null;
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!local) return;
    const { x, y } = pos(e);
    const s = slotAt(x, y);
    if (s !== null && local.tray[s] !== null) {
      setSelected(s);
      return;
    }
    const cell = cellAt(x, y);
    if (cell && selected !== null) place(selected, cell.row, cell.col);
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!local || selected === null) return;
    const { x, y } = pos(e);
    const cell = cellAt(x, y);
    const piece = local.tray[selected];
    if (!cell || piece === null) return setGhost(null);
    const p = PIECES[piece];
    setGhost({ row: Math.min(cell.row, 8 - p.rows), col: Math.min(cell.col, 8 - p.cols) });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      if (local && e.key >= '1' && e.key <= '3') {
        const i = (Number(e.key) - 1) as 0 | 1 | 2;
        if (local.tray[i] !== null) setSelected(i);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [local]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !local) return;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const board: Cell[][] = Array.from({ length: 8 }, (_, r) =>
      Array.from({ length: 8 }, (_, c) => {
        const col = colors[r * 8 + c];
        return col ? { type: 'block' as const, color: col } : { type: 'empty' as const };
      }));
    const render = () => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      drawBoard(ctx, board, ORIGIN, ORIGIN);
      if (selected !== null && ghost && local.tray[selected] !== null) {
        const piece = local.tray[selected]!;
        drawGhostPiece(ctx, PIECES[piece].shape, colorOf(piece, local.moves), ghost.row, ghost.col, ORIGIN, ORIGIN,
          fits(boardFromHex(local.board), piece, ghost.row, ghost.col));
      }
      particles.current = updateParticles(particles.current);
      drawParticles(ctx, particles.current);

      ctx.save();
      ctx.fillStyle = 'rgba(6, 6, 20, 0.88)';
      ctx.beginPath();
      roundRect(ctx, 0, TRAY_Y - 20, CANVAS_W, 150, 20);
      ctx.fill();
      ctx.restore();
      const b = boardFromHex(local.board);
      for (let i = 0; i < 3; i++) {
        const piece = local.tray[i];
        const cx = (CANVAS_W / 3) * i + CANVAS_W / 6;
        const cy = TRAY_Y + 45;
        if (piece === null) {
          ctx.save();
          ctx.globalAlpha = busy ? 0.35 + 0.25 * Math.sin(Date.now() / 180) : 0.1;
          ctx.strokeStyle = '#8888BB';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          roundRect(ctx, cx - 30, cy - 30, 60, 60, 10);
          ctx.stroke();
          ctx.restore();
          continue;
        }
        const placeable = PIECES[piece] && fitsAnyPos(b, piece);
        drawTrayPiece(ctx, { shape: PIECES[piece].shape, color: colorOf(piece, local.moves + i) }, cx, cy, TRAY_CELL,
          selected === i, placeable, selected === i ? 1.15 : 1);
      }
      const now = Date.now();
      pops.current = pops.current.filter((p) => now - p.start < 1500);
      for (const p of pops.current) drawScorePop(ctx, translatePop(tg, p.label), p.points, CANVAS_W / 2, CANVAS_H * 0.4, (now - p.start) / 1500);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [local, colors, selected, ghost, busy, tg]);

  // ── Screens ──────────────────────────────────────────────────────
  const rules = (
    <ol className={rs.rules}>
      <li className={rs.rule}>{t('rule_ticket', RANKED_VARS)}</li>
      <li className={rs.rule}>{t('rule_attempts', RANKED_VARS)}</li>
      <li className={rs.rule}>{t('rule_server')}</li>
      <li className={rs.rule}>{t('rule_verify')}</li>
      <li className={rs.rule}>{t('rule_daily', RANKED_VARS)}</li>
      <li className={rs.rule}>{t('rule_monthly', RANKED_VARS)}</li>
    </ol>
  );
  const split = (
    <div className={rs.split}>
      <p className={rs.splitTitle}>{t('split_title')}</p>
      <div className={rs.splitBar} aria-hidden>
        <span style={{ width: `${RANKED.vaultPct}%`, background: 'var(--ds-block-2, #5eead4)' }} />
        <span style={{ width: `${RANKED.teamPct}%`, background: 'var(--ds-block-1, #a78bfa)' }} />
        <span style={{ width: `${RANKED.referralPct}%`, background: 'var(--ds-block-3, #fbbf24)' }} />
      </div>
      <p className={rs.splitBody}>{t('split_body', RANKED_VARS)}</p>

      <p className={rs.splitTitle} style={{ marginTop: 16 }}>{t('vault_title')}</p>
      <div className={rs.splitBar} aria-hidden>
        <span style={{ width: `${RANKED.dailyPct}%`, background: 'var(--ds-block-4, #f472b6)' }} />
        <span style={{ width: `${RANKED.monthlyPct}%`, background: 'var(--ds-block-5, #7dd3fc)' }} />
      </div>
      <ul className={rs.legend}>
        <li><span className={rs.swatch} style={{ background: 'var(--ds-block-4, #f472b6)' }} />{t('vault_daily', RANKED_VARS)}</li>
        <li><span className={rs.swatch} style={{ background: 'var(--ds-block-5, #7dd3fc)' }} />{t('vault_monthly', RANKED_VARS)}</li>
      </ul>
      <p className={rs.splitBody}>{t('vault_body', RANKED_VARS)}</p>
      <p className={rs.splitBody} style={{ marginTop: 8 }}>{t('claim_note')}</p>
    </div>
  );

  if (!connected || !wallet) {
    return (
      <MascotCard alt={t('mascot_alt')}>
        <span className={rs.kicker}>{t('kicker')}</span>
        <h1 className={rs.title}>{t('daily_ranked')}</h1>
        <p className={rs.lede}>{t('lede', RANKED_VARS)}</p>
        {rules}
        <p className={rs.status}>{RANKED_SALES_OPEN ? t('sales_open_now') : t('sales_soon')}</p>
        {split}
        <div className={rs.actions}>
          <button type="button" className={styles.btnMain} onClick={() => setVisible(true)}>
            {connecting ? t('connecting') : t('connect_btn')}
          </button>
          <p className={rs.note}>{t('connect_wallet')}</p>
        </div>
      </MascotCard>
    );
  }

  if (!client) {
    return (
      <MascotCard alt={t('mascot_alt')}>
        <span className={rs.kicker}>{t('daily_ranked')}</span>
        <h1 className={rs.title}>{t('sign_in')}</h1>
        <PlayerRow avatarId={avatarId} wallet={wallet} t={t} />
        <p className={rs.lede}>{t('sign_in_desc')}</p>
        <div className={rs.actions}>
          <button type="button" className={styles.btnMain} onClick={signIn} disabled={busy}>
            {busy ? t('waiting_for_wallet') : t('sign_in_btn')}
          </button>
        </div>
        {error && <p className={rs.error}>{error}</p>}
      </MascotCard>
    );
  }

  const open = me?.runs.find((r) => !r.over);
  const attemptsLeft = me ? me.maxAttempts - me.attempts : 0;
  const bestToday = me && me.runs.length > 0 ? Math.max(...me.runs.map((r) => r.score)) : null;

  if (!runId || !local) {
    return (
      <MascotCard alt={t('mascot_alt')}>
        {me ? (
          <>
            <span className={rs.kicker}>{t('kicker')}</span>
            <h1 className={rs.title}>{t('daily_ranked')}</h1>
            <p className={rs.sub}>{t('utc_day', { day: me.day })}</p>

            <PlayerRow avatarId={avatarId} wallet={wallet} t={t} />

            <div className={rs.stats}>
              <div className={rs.stat}>
                <div className={rs.statLabel}>{t('attempts_label')}</div>
                <div className={rs.statValue}>{me.attempts}/{me.maxAttempts}</div>
                <div className={rs.pips} aria-hidden>
                  {Array.from({ length: me.maxAttempts }).map((_, i) => (
                    <span key={i} className={`${rs.pip} ${i < me.attempts ? rs.pipUsed : ''}`} />
                  ))}
                </div>
              </div>
              <div className={rs.stat}>
                <div className={rs.statLabel}>{t('time_left')}</div>
                <div className={rs.statValue}>
                  {countdown ? t('countdown', { h: countdown.h, m: countdown.m, s: countdown.s }) : '…'}
                </div>
              </div>
            </div>

            <div className={rs.seed}>
              <div className={rs.statLabel}>{t('seed_label')}</div>
              <code>{me.commitment}</code>
            </div>

            {!me.salesOpen && <p className={rs.status}>{t('sales_soon')}</p>}

            <div className={rs.actions}>
              {open && (
                <button type="button" className={styles.btnMain} onClick={() => resume(open.id)} disabled={busy}>
                  {t('resume_attempt', { attempt: open.attempt })}
                </button>
              )}
              {!open && attemptsLeft > 0 && me.credits > 0 && me.salesOpen && (
                <button type="button" className={styles.btnMain} onClick={start} disabled={busy}>
                  {t('start_attempt', { attempt: me.attempts + 1 })}
                </button>
              )}
              {!open && attemptsLeft > 0 && (me.credits === 0 || !me.salesOpen) && (
                <button type="button" className={styles.btnMain} disabled>
                  {me.salesOpen ? t('get_tickets') : t('ticket_sales_open_soon')}
                </button>
              )}
              {attemptsLeft === 0 && !open && <p className={rs.note}>{t('all_attempts_used')}</p>}
              <Link href="/leaderboard" className={styles.btnGhost}>{t('see_leaderboard')}</Link>
            </div>

            {me.runs.length > 0 && (
              <ul className={rs.runs} aria-label={t('your_runs')}>
                {me.runs.map((r) => (
                  <li key={r.attempt}>
                    {t('run_row', { n: r.attempt, score: formatScore(r.score) })}{!r.over && ` · ${t('in_progress')}`}
                  </li>
                ))}
              </ul>
            )}

            <details className={rs.details} style={{ marginTop: 18, marginBottom: 0 }}>
              <summary>{t('rules_title')}</summary>
              <div className={rs.detailsBody}>
                {rules}
                {split}
              </div>
            </details>
          </>
        ) : (
          <div className={rs.loading}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            {t('loading')}
          </div>
        )}
        {error && <p className={rs.error}>{error}</p>}
      </MascotCard>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.hud}>
        <div className={styles.hudStat}>
          <span className={styles.hudLabel}>{t('score')}</span>
          <span className={styles.hudValue}>{formatScore(local.score)}</span>
        </div>
        <div className={styles.hudCenter}>
          <span className={styles.levelBadge}>{t('ranked_badge', { n: attempt })}</span>
          {local.chain > 1 && (
            <div className={styles.chainBadge}>
              <span>{t('chain_badge', { n: local.chain })}</span>
            </div>
          )}
        </div>
        <div className={`${styles.hudStat} ${styles.hudStatEnd}`}>
          <span className={styles.hudLabel}>{t('placed')}</span>
          <span className={styles.hudValue}>{local.moves}</span>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className={styles.canvas}
        onClick={onClick}
        onMouseMove={onMove}
        onMouseLeave={() => setGhost(null)}
        style={{ cursor: selected !== null ? 'crosshair' : 'default' }}
      />

      <div className={styles.hint}>
        <span><kbd className={styles.hintKey}>1-3</kbd> {t('hint_select')}</span>
        <span><kbd className={styles.hintKey}>{t('key_click')}</kbd> {t('hint_place')}</span>
        <span>{t('hint_server')}</span>
      </div>
      {error && <p className={rs.warnText}>{error}</p>}

      {(local.over || closedMsg) && !busy && pending.length === 0 && (
        <div className={rs.result} role="region" aria-live="polite" aria-labelledby="ranked-result-title">
          <PlayerAvatar id={avatarId} size={64} label={t('your_avatar')} className={rs.resultAvatar} />
          <div id="ranked-result-title" className={rs.endTitle}>
            {closedMsg ? t('day_closed') : t('run_over')}
          </div>
          <div className={rs.resultScore} aria-label={t('attempt_score', { n: attempt })}>
            {formatScore(server?.score ?? local.score)}
          </div>
          {bestToday !== null && <div className={rs.endNote}>{t('best_today', { score: formatScore(bestToday) })}</div>}
          <div className={rs.endNote}>
            {closedMsg ?? t('score_computed')}
          </div>
          <div className={rs.endRow}>
            <button type="button" className={styles.btnMain} onClick={() => { setRunId(null); if (client) refreshMe(client); }}>
              {t('back')}
            </button>
            <Link href="/leaderboard" className={styles.btnGhost}>{t('leaderboard')}</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function fitsAnyPos(board: bigint, piece: number): boolean {
  const p = PIECES[piece];
  for (let r = 0; r + p.rows <= 8; r++) for (let c = 0; c + p.cols <= 8; c++) if (fits(board, piece, r, c)) return true;
  return false;
}
