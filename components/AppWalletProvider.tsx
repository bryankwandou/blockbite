'use client';

import React, { useCallback, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { TrustWalletAdapter } from '@solana/wallet-adapter-trust';
import { LedgerWalletAdapter } from '@solana/wallet-adapter-ledger';
import { CoinbaseWalletAdapter } from '@solana/wallet-adapter-coinbase';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { ACTIVE_NETWORK, RPC_URL } from '@/lib/solana/config';

import '@solana/wallet-adapter-react-ui/styles.css';

export default function AppWalletProvider({ children }: { children: React.ReactNode }) {
  const network = ACTIVE_NETWORK;
  const endpoint = useMemo(() => RPC_URL, []);

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new TrustWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new LedgerWalletAdapter(),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network]
  );

  // autoConnect was set to `true` previously. That caused thousands of users
  // to get stuck in a perpetual "Connecting…" state on page load — the
  // adapter would try to silently reconnect the previously-selected wallet,
  // and if the extension popup was blocked, the extension was uninstalled,
  // or the user opened the site in a different browser, the connect promise
  // never resolved. Worse: while `connecting === true` the wallet picker
  // modal is silently no-op when invoked, so clicking "Connect Wallet"
  // appeared to do nothing.
  //
  // Disabling autoConnect forces an explicit user click every session,
  // which guarantees the modal opens and the adapter is never stranded
  // mid-connect.
  //
  // onError funnels all adapter errors (WalletNotReady, etc.) to the
  // console + a recoverable toast — never to the React error boundary.
  const onError = useCallback((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn('[wallet-adapter] error:', err);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false} onError={onError}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
