import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWallet,
  walletFromPrivate,
  getBalance,
  getDenomination,
  getNonce,
  requestFaucet,
  pollBalanceUntilFunded,
  DEFAULT_DENOMINATION,
  type Wallet,
} from '../lib/sayman';

const STORAGE_KEY = 'sayforge.wallet.v1';

export type FundingState = 'idle' | 'requesting' | 'pending' | 'funded' | 'error';

export interface UseWallet {
  wallet: Wallet | null;
  balance: number;
  denomination: number;
  funding: FundingState;
  fundingMsg: string;
  refreshBalance: () => Promise<void>;
  fund: () => Promise<void>;
  importKey: (privateKeyHex: string) => void;
  regenerate: () => void;
  nextNonce: () => Promise<number>;
}

function loadWallet(): Wallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.privateKey) return walletFromPrivate(parsed.privateKey);
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

function saveWallet(w: Wallet) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ privateKey: w.privateKey }));
  } catch {
    /* storage may be unavailable */
  }
}

export function useWallet(): UseWallet {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balance, setBalance] = useState(0);
  const [denomination, setDenomination] = useState(DEFAULT_DENOMINATION);
  const [funding, setFunding] = useState<FundingState>('idle');
  const [fundingMsg, setFundingMsg] = useState('');

  // Local nonce tracker so back-to-back txs in one session don't collide.
  const localNonce = useRef<number | null>(null);

  // Bootstrap wallet + denomination on first load.
  useEffect(() => {
    let w = loadWallet();
    if (!w) {
      w = createWallet();
      saveWallet(w);
    }
    setWallet(w);
    getDenomination().then(setDenomination).catch(() => {});
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!wallet) return;
    try {
      const b = await getBalance(wallet.address);
      setBalance(b);
    } catch {
      /* leave balance as-is */
    }
  }, [wallet]);

  // Poll balance periodically while the wallet exists.
  useEffect(() => {
    if (!wallet) return;
    refreshBalance();
    const id = setInterval(refreshBalance, 8000);
    return () => clearInterval(id);
  }, [wallet, refreshBalance]);

  const fund = useCallback(async () => {
    if (!wallet) return;
    setFunding('requesting');
    setFundingMsg('Requesting testnet drip…');
    try {
      await requestFaucet(wallet.address);
      setFunding('pending');
      setFundingMsg('Funding your session wallet… (lands on the next block, ~5s)');
      const b = await pollBalanceUntilFunded(wallet.address, {
        timeoutMs: 40000,
        intervalMs: 2500,
        onTick: (bal) => setBalance(bal),
      });
      if (b > 0) {
        setBalance(b);
        setFunding('funded');
        setFundingMsg('');
        // reset local nonce; the account may have changed on-chain
        localNonce.current = null;
      } else {
        setFunding('error');
        setFundingMsg('Faucet did not land in time. It may be dry — try again shortly.');
      }
    } catch (e: any) {
      setFunding('error');
      setFundingMsg(e?.message || 'Faucet request failed.');
    }
  }, [wallet]);

  const importKey = useCallback((privateKeyHex: string) => {
    const w = walletFromPrivate(privateKeyHex);
    saveWallet(w);
    setWallet(w);
    setBalance(0);
    localNonce.current = null;
    setFunding('idle');
    setFundingMsg('');
  }, []);

  const regenerate = useCallback(() => {
    const w = createWallet();
    saveWallet(w);
    setWallet(w);
    setBalance(0);
    localNonce.current = null;
    setFunding('idle');
    setFundingMsg('');
  }, []);

  // Fetch on-chain nonce, then hand out monotonically increasing values within a session.
  const nextNonce = useCallback(async (): Promise<number> => {
    if (!wallet) return 0;
    const chainNonce = await getNonce(wallet.address);
    const candidate =
      localNonce.current == null ? chainNonce : Math.max(chainNonce, localNonce.current);
    localNonce.current = candidate + 1;
    return candidate;
  }, [wallet]);

  return {
    wallet,
    balance,
    denomination,
    funding,
    fundingMsg,
    refreshBalance,
    fund,
    importKey,
    regenerate,
    nextNonce,
  };
}
