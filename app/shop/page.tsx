'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import PoolBalance from '@/components/PoolBalance';
import ResetClock from '@/components/ResetClock';
import { TICKET_PACKAGES } from '@/lib/game/constants';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  purchaseTickets, getUsdcBalance, fetchRecordedReferrer, purchaseWindowOpen,
  InsufficientFundsError, NoTokenAccountError, SalesClosedError,
} from '@/lib/solana/usdc';
import { RankedApiError, RankedClient } from '@/lib/ranked/client';
import { RANKED_SALES_OPEN } from '@/lib/ranked/config';
import { autoconvertSolForUsdc, SwapUnavailableError, SwapFailedError } from '@/lib/solana/jupiter-swap';
import { explorerTx } from '@/lib/solana/config';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';
import s from './shop.module.css';

/** 100 blocks = 1 USDC: 70 prize vault, 25 team, 5 referrer. */
// Signatures paid but not yet credited, per wallet. The server credits a tx
// only within 6 h of its block time, so a lost credit call is retried on the
// next visit instead of being forgotten.
const pendingKey = (w: string) => `bb_rk_pending_credit_${w}`;
function readPending(w: string): string[] {
  try { return JSON.parse(localStorage.getItem(pendingKey(w)) ?? '[]') as string[]; } catch { return []; }
}
function writePending(w: string, sigs: string[]) {
  try {
    if (sigs.length) localStorage.setItem(pendingKey(w), JSON.stringify(sigs));
    else localStorage.removeItem(pendingKey(w));
  } catch { /* recovery only */ }
}

/**
 * Credits `sig`, retrying while the server cannot see it yet (it reads the tx
 * at 'finalized', ~15-30 s after confirmation). A 4xx other than 404/429 is a
 * final refusal and is thrown at once.
 */
async function creditWithRetry(client: RankedClient, sig: string): Promise<number> {
  const deadline = Date.now() + 3 * 60_000;
  for (let i = 0; ; i++) {
    try {
      return (await client.credit(sig)).credits;
    } catch (e) {
      const status = e instanceof RankedApiError ? e.status : 0;
      const retry = status === 0 || status === 404 || status === 429 || status >= 500;
      if (!retry || Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, Math.min(2500 * 2 ** Math.min(i, 3), 15_000)));
    }
  }
}

const CELLS = Array.from({ length: 100 }, (_, i) => (i < 70 ? 'vault' : i < 95 ? 'team' : 'ref'));

export default function ShopPage() {
  const t = useT('shop');
  const [buying, setBuying]           = useState<string | null>(null);
  const [txSig, setTxSig]             = useState<string | null>(null);
  const [txError, setTxError]         = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const { publicKey, connected, sendTransaction, signMessage } = useWallet();
  const { connection } = useConnection();
  const [ticketBalance, setTicketBalance] = useState<number>(0);

  // Ticket credits live on the server (bought on-chain, verified there).
  useEffect(() => {
    if (!publicKey) return;
    const w = publicKey.toBase58();
    const c = RankedClient.cached(w);
    if (!c) return;
    c.me().then((m) => setTicketBalance(m.credits)).catch(() => {});
    // Finish credits a previous visit paid for but could not record.
    (async () => {
      for (const sig of readPending(w)) {
        try {
          setTicketBalance(await creditWithRetry(c, sig));
          writePending(w, readPending(w).filter((x) => x !== sig));
        } catch (e) {
          if (e instanceof RankedApiError && e.status === 422) {
            writePending(w, readPending(w).filter((x) => x !== sig));
            setTxError(t('err_not_credited', { sig: sig.slice(0, 8), msg: e.message }));
          }
        }
      }
    })();
  }, [publicKey, t]);

  // Fetch real on-chain USDC balance
  useEffect(() => {
    if (!publicKey || !connection) return;
    getUsdcBalance(connection, publicKey).then(setUsdcBalance);
  }, [publicKey, connection]);

  const handleBuy = useCallback(async (pkg: typeof TICKET_PACKAGES[0]) => {
    if (!connected || !publicKey) {
      setTxError(t('err_connect'));
      return;
    }
    setTxError(null);
    setTxSig(null);
    if (!RANKED_SALES_OPEN) {
      setTxError(t('err_closed'));
      return;
    }
    if (!purchaseWindowOpen()) {
      setTxError(t('err_day_closing'));
      return;
    }
    if (!signMessage) {
      setTxError(t('err_sign'));
      return;
    }
    setBuying(pkg.id);

    try {
      // Sign in first, so a paid purchase can always be credited.
      const client = await RankedClient.connect(publicKey.toBase58(), signMessage);
      // ── Pre-step: SOL→USDC autoconvert (mainnet only) ──────────────────
      // If the buyer doesn't have enough USDC, Jupiter swaps the deficit
      // from their SOL automatically before the ticket transfer runs.
      // If no route is available it falls through to the InsufficientFunds
      // error path below.
      const currentUsdc = (usdcBalance ?? 0);
      const deficit = pkg.price - currentUsdc;
      if (deficit > 0) {
        try {
          const swapSig = await autoconvertSolForUsdc({
            connection,
            payer: publicKey,
            usdcDeficit: deficit + 0.1, // tiny buffer for slippage rounding
            sendTransaction: sendTransaction as Parameters<typeof autoconvertSolForUsdc>[0]['sendTransaction'],
          });
          if (swapSig) {
            // Re-read balance so the buy sees the freshly swapped USDC.
            const fresh = await getUsdcBalance(connection, publicKey);
            setUsdcBalance(fresh);
          }
        } catch (swapErr) {
          if (swapErr instanceof SwapUnavailableError) {
            // No swap route — fall through to the balance check.
          } else if (swapErr instanceof SwapFailedError) {
            setTxError(swapErr.message);
            setBuying(null);
            return;
          } else {
            throw swapErr;
          }
        }
      }

      // Plain USDC transfers: 70% vault · 5% referrer · rest team. The
      // referrer is the one the SERVER recorded for this wallet (it only
      // accepts that one); a /r/ code in localStorage never picks the recipient.
      const wallet = publicKey.toBase58();
      const recordedReferrer = await fetchRecordedReferrer(client.authorization);
      const sig = await purchaseTickets({
        connection,
        payer: publicKey,
        tickets: pkg.tickets,
        recordedReferrer,
        sendTransaction,
        onSent: (x) => writePending(wallet, [...readPending(wallet).filter((p) => p !== x), x]),
      });

      setTxSig(sig);
      // Credit now: the server only credits within 6 h of the block time.
      // Crediting is idempotent per signature; a failure stays pending and is
      // retried on the next visit.
      try {
        setTicketBalance(await creditWithRetry(client, sig));
        writePending(wallet, readPending(wallet).filter((p) => p !== sig));
      } catch (e) {
        if (e instanceof RankedApiError && e.status === 422) writePending(wallet, readPending(wallet).filter((p) => p !== sig));
        throw new Error(t('err_not_credited', { sig: sig.slice(0, 8), msg: e instanceof Error ? e.message : String(e) }));
      }

      // Refresh USDC balance
      const newUsdc = await getUsdcBalance(connection, publicKey);
      setUsdcBalance(newUsdc);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        setTxError(t('err_funds', { have: `${err.have.toFixed(2)} USDC`, need: `${err.need.toFixed(2)} USDC` }));
      } else if (err instanceof NoTokenAccountError) {
        setTxError(t('err_no_account'));
      } else if (err instanceof SalesClosedError) {
        setTxError(err.message);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setTxError(t('err_tx', { msg }));
      }
    } finally {
      setBuying(null);
    }
  }, [connected, publicKey, connection, sendTransaction, signMessage, usdcBalance, t]);

  const daysLabel = (n: number) => t('days_short', { n });

  return (
    <>
      <Navbar />
      <main className={k.page}>
        {/* Header */}
        <header className={k.head}>
          <div className={`${k.wrap} ${k.headInner}`}>
            <div className={k.kicker}><span className={k.pips} aria-hidden><i /><i /><i /></span>{t('kicker')}</div>
            <h1 className={k.title}>{t('title')}</h1>
            <p className={k.lede}>{t('headline')}</p>

            {!RANKED_SALES_OPEN && (
              <div className={k.notice} role="status">
                <span className={k.noticeTitle}>{t('closed_title')}</span>
                <p className={k.noticeText}>{t('sales_closed')}</p>
                <Link href="/game" className={k.btnGhost}>{t('play_free')}</Link>
              </div>
            )}

            <div className={k.stats}>
              <div className={`${k.card} ${k.stat}`}>
                <span className={k.statK}>{t('stat_pool')}</span>
                <PoolBalance className={k.statV} />
                <span className={k.statNote}>{t('stat_pool_note')}</span>
              </div>
              <div className={`${k.card} ${k.stat}`}>
                <span className={k.statK}>{t('stat_day')}</span>
                <ResetClock kind="day" className={k.statV} daysLabel={daysLabel} />
              </div>
              <div className={`${k.card} ${k.stat}`}>
                <span className={k.statK}>{t('stat_month')}</span>
                <ResetClock kind="month" className={k.statV} daysLabel={daysLabel} />
              </div>
              {connected && (
                <>
                  <div className={`${k.card} ${k.stat}`}>
                    <span className={k.statK}>{t('stat_tickets')}</span>
                    <span className={k.statV}>{ticketBalance}</span>
                  </div>
                  <div className={`${k.card} ${k.stat}`}>
                    <span className={k.statK}>{t('stat_usdc')}</span>
                    <span className={k.statV} dir="ltr">{usdcBalance !== null ? usdcBalance.toFixed(2) : '—'}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className={k.wrap}>
          {/* Tx feedback */}
          {txSig && (
            <div className={k.msgOk} role="status">
              {t('purchase_confirmed')}{' '}
              <a href={explorerTx(txSig)} target="_blank" rel="noopener noreferrer">{t('view_tx')}</a>
            </div>
          )}
          {txError && <div className={k.msgErr} role="alert">{txError}</div>}

          {/* Packs */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('packs_title')}</h2>
            <div className={s.packs}>
              {TICKET_PACKAGES.map((pkg, idx) => {
                const isBuying = buying === pkg.id;
                return (
                  <div key={pkg.id} id={`shop-pkg-${pkg.id}`} className={`${k.card} ${k.lift} ${k.rise} ${s.pack}`} style={{ animationDelay: `${idx * 60}ms` }}>
                    <div className={s.packTop}>
                      <span className={s.packName}>{t(`pkg_${pkg.id}`)}</span>
                      <span className={s.packDots} aria-hidden>
                        {Array.from({ length: Math.min(pkg.tickets, 10) }, (_, i) => <i key={i} />)}
                      </span>
                    </div>
                    <div className={s.packBody}>
                      <div className={s.packCount}>
                        {pkg.tickets}
                        <small>{pkg.tickets > 1 ? t('tickets') : t('ticket')}</small>
                      </div>
                      <p className={s.packNote}>{t(`pkg_${pkg.id}_note`)}</p>
                      <div className={s.packPrice}>
                        <span className={s.price} dir="ltr">{pkg.price} USDC</span>
                        <span className={s.toPool}>{t('to_pool', { n: (pkg.price * 0.7).toFixed(2) })}</span>
                      </div>
                    </div>
                    <div className={s.packFoot}>
                      <button
                        type="button"
                        className={k.btn}
                        onClick={() => handleBuy(pkg)}
                        disabled={!RANKED_SALES_OPEN || !!buying}
                      >
                        {isBuying ? (
                          <><span className={s.spin} aria-hidden />{t('processing')}</>
                        ) : !RANKED_SALES_OPEN ? (
                          t('opening_soon')
                        ) : (
                          t('buy_n', { n: pkg.tickets })
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Where the money goes */}
          <section className={k.section}>
            <h2 className={k.h2}>{t('split_kicker')}</h2>
            <div className={`${k.card} ${s.split}`}>
              <div className={s.cells} aria-hidden>
                {CELLS.map((c, i) => (
                  <span key={i} className={`${s.cell} ${s[c]}`} style={{ animationDelay: `${i * 6}ms` }} />
                ))}
              </div>
              <div className={s.legend}>
                <div className={s.legendRow}>
                  <span className={`${s.pct} ${s.pctVault}`}>70%</span>
                  <span className={s.legendLabel}>{t('split_vault')}</span>
                </div>
                <div className={s.legendRow}>
                  <span className={`${s.pct} ${s.pctTeam}`}>25%</span>
                  <span className={s.legendLabel}>{t('split_team')}</span>
                </div>
                <div className={s.legendRow}>
                  <span className={`${s.pct} ${s.pctRef}`}>5%</span>
                  <span className={s.legendLabel}>{t('split_ref')}</span>
                </div>
                <p className={k.body}>{t('split_info')}</p>
              </div>
            </div>
          </section>

          {/* Receipt + rules */}
          <section className={k.section}>
            <div className={k.card}>
              <h3 className={k.h3}>{t('info_credits_title')}</h3>
              <p className={k.body}>{t('info_credits_desc')}</p>
            </div>
            <p className={k.fine}>{t('legal')}</p>
          </section>
        </div>
      </main>
    </>
  );
}
