'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import PoolBalance from '@/components/PoolBalance';
import ResetClock from '@/components/ResetClock';
import { TICKET_PACKAGES } from '@/lib/game/constants';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { purchaseTickets, getUsdcBalance, InsufficientFundsError, NoTokenAccountError, SalesClosedError } from '@/lib/solana/usdc';
import { RankedClient } from '@/lib/ranked/client';
import { RANKED_SALES_OPEN } from '@/lib/ranked/config';
import { autoconvertSolForUsdc, SwapUnavailableError, SwapFailedError } from '@/lib/solana/jupiter-swap';
import { explorerTx } from '@/lib/solana/config';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';
import s from './shop.module.css';

/** 100 blocks = 1 USDC: 70 prize vault, 25 team, 5 referrer. */
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
    const c = RankedClient.cached(publicKey.toBase58());
    if (c) c.me().then((m) => setTicketBalance(m.credits)).catch(() => {});
  }, [publicKey]);

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

      // Plain USDC transfers: 70% vault · 5% referrer · rest team.
      // Referrer from /r/<wallet>; an invalid or missing code pays the team.
      let referrer: PublicKey | undefined;
      try {
        const code = localStorage.getItem('bb_referrer_code');
        if (code) referrer = new PublicKey(code);
      } catch { referrer = undefined; }
      const sig = await purchaseTickets({
        connection,
        payer: publicKey,
        tickets: pkg.tickets,
        referrer,
        sendTransaction,
      });

      setTxSig(sig);
      // The server checks the transaction on-chain before crediting; retry
      // while the RPC catches up. Crediting is idempotent per signature.
      let credited = false;
      for (let i = 0; i < 6 && !credited; i++) {
        try {
          setTicketBalance((await client.credit(sig)).credits);
          credited = true;
        } catch (e) {
          if (i === 5) throw new Error(t('err_not_credited', { sig: sig.slice(0, 8), msg: e instanceof Error ? e.message : String(e) }));
          await new Promise((r) => setTimeout(r, 2500));
        }
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
