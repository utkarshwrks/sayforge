import { useState } from 'react';
import type { UseWallet } from '../hooks/useWallet';
import { formatSayn } from '../lib/sayman';
import { truncate, copyToClipboard, classNames } from '../lib/ui';

export default function WalletStrip({ w }: { w: UseWallet }) {
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [importError, setImportError] = useState('');

  if (!w.wallet) {
    return (
      <div className="card px-4 py-2 text-sm text-forge-muted animate-forgepulse">
        Creating session wallet…
      </div>
    );
  }

  const onCopy = async () => {
    if (await copyToClipboard(w.wallet!.address)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  const onImport = () => {
    setImportError('');
    try {
      w.importKey(keyInput);
      setImporting(false);
      setKeyInput('');
    } catch (e: any) {
      setImportError(e?.message || 'Invalid private key.');
    }
  };

  const funded = w.balance > 0;

  return (
    <div className="card flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={classNames(
            'h-2 w-2 rounded-full',
            funded ? 'bg-forge-ok' : 'bg-forge-warn animate-forgepulse'
          )}
          title={funded ? 'Funded' : 'Unfunded'}
        />
        <span className="text-xs uppercase tracking-wide text-forge-muted">Session wallet</span>
      </div>

      <button onClick={onCopy} className="mono text-sm text-forge-text hover:text-white" title="Copy address">
        {truncate(w.wallet.address, 8, 6)}
        <span className="ml-2 text-xs text-forge-muted">{copied ? 'copied ✓' : '⧉'}</span>
      </button>

      <div className="mono text-sm">
        <span className="text-forge-accent2 font-semibold">{formatSayn(w.balance, w.denomination)}</span>
        <span className="ml-1 text-forge-muted">SAYN</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {w.funding === 'pending' || w.funding === 'requesting' ? (
          <span className="text-xs text-forge-warn animate-forgepulse">{w.fundingMsg}</span>
        ) : w.funding === 'error' ? (
          <span className="text-xs text-forge-fail">{w.fundingMsg}</span>
        ) : null}

        <button
          onClick={w.fund}
          disabled={w.funding === 'requesting' || w.funding === 'pending'}
          className="btn btn-ghost py-1.5"
          title="Drip 1000 testnet SAYN to this wallet"
        >
          {w.funding === 'requesting' || w.funding === 'pending' ? 'Funding…' : 'Fund'}
        </button>

        <button onClick={() => setImporting((v) => !v)} className="btn btn-ghost py-1.5">
          Import key
        </button>
        <button onClick={w.regenerate} className="btn btn-ghost py-1.5" title="Generate a fresh wallet">
          New
        </button>
      </div>

      {importing && (
        <div className="w-full border-t border-forge-border pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Paste a 64-hex private key"
              className="mono min-w-[280px] flex-1 rounded-lg border border-forge-border bg-forge-bg px-3 py-2 text-sm outline-none focus:border-forge-accent"
            />
            <button onClick={onImport} className="btn btn-primary py-2">
              Import
            </button>
            <button onClick={() => setImporting(false)} className="btn btn-ghost py-2">
              Cancel
            </button>
          </div>
          {importError && <p className="mt-2 text-xs text-forge-fail">{importError}</p>}
          <p className="mt-2 text-xs text-forge-muted">
            Testnet keys only. This wallet is stored in your browser's localStorage.
          </p>
        </div>
      )}
    </div>
  );
}
