import { useState } from 'react';
import type { UseWallet } from '../hooks/useWallet';
import {
  deployContract,
  listContracts,
  pollForContractByName,
  explorerContractUrl,
  explorerTxUrl,
  type FeePolicy,
} from '../lib/sayman';

type DeployStage =
  | 'idle'
  | 'need-funds'
  | 'signing'
  | 'mempool'
  | 'polling'
  | 'resolved'
  | 'timeout'
  | 'error';

export interface DeployedInfo {
  address: string;
  txId?: string;
  name: string;
}

export default function DeployPanel({
  w,
  contractName,
  code,
  canDeploy,
  saymanRpc,
  deployed,
  onDeployed,
}: {
  w: UseWallet;
  contractName: string;
  code: string;
  canDeploy: boolean;
  saymanRpc: string;
  deployed: DeployedInfo | null;
  onDeployed: (info: DeployedInfo) => void;
}) {
  const [stage, setStage] = useState<DeployStage>('idle');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [txId, setTxId] = useState<string | undefined>();
  const [feePolicy, setFeePolicy] = useState<FeePolicy['policy']>('sponsor');

  const funded = w.balance > 0;

  const run = async () => {
    if (!w.wallet) return;
    setError('');
    setTxId(undefined);

    if (!funded) {
      setStage('need-funds');
      setMsg('Your session wallet needs testnet SAYN to pay deploy gas. Click Fund first.');
      return;
    }

    try {
      // Snapshot existing contracts so we can spot the freshly deployed one.
      const before = await listContracts().catch(() => []);
      const beforeAddrs = new Set(before.map((c) => c.address));

      setStage('signing');
      setMsg('Signing deploy transaction in your browser…');
      const nonce = await w.nextNonce();
      const timestamp = Date.now();

      const result = await deployContract({
        wallet: w.wallet,
        name: contractName,
        code,
        feePolicy,
        nonce,
        timestamp,
      });
      setTxId(result.txId);

      setStage('mempool');
      setMsg('Queued in the mempool. Waiting for the next block (~5s)…');

      setStage('polling');
      setMsg('Block produced — resolving your contract address…');
      const contract = await pollForContractByName(contractName, {
        timeoutMs: 22000,
        intervalMs: 2500,
        sinceAddresses: beforeAddrs,
      });

      if (contract?.address) {
        setStage('resolved');
        setMsg('');
        onDeployed({ address: contract.address, txId: result.txId, name: contractName });
        w.refreshBalance();
      } else {
        setStage('timeout');
        setMsg('Deploy is still pending after 22s. It may land shortly — retry to re-check.');
      }
    } catch (e: any) {
      setStage('error');
      setError(friendlyDeployError(e?.message));
    }
  };

  const busy = stage === 'signing' || stage === 'mempool' || stage === 'polling';

  if (deployed) {
    return (
      <div className="rounded-xl border border-forge-ok/40 bg-forge-ok/10 p-4">
        <div className="flex items-center gap-2">
          <span className="text-forge-ok">●</span>
          <span className="font-semibold text-forge-ok">Deployed to SAYMAN testnet</span>
        </div>
        <div className="mono mt-2 break-all text-sm text-forge-text">{deployed.address}</div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <a
            className="text-forge-accent hover:underline"
            href={explorerContractUrl(saymanRpc, deployed.address)}
            target="_blank"
            rel="noreferrer"
          >
            View contract ↗
          </a>
          {deployed.txId && (
            <a
              className="text-forge-accent hover:underline"
              href={explorerTxUrl(saymanRpc, deployed.txId)}
              target="_blank"
              rel="noreferrer"
            >
              View deploy tx ↗
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-forge-border bg-forge-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Deploy</p>
          <p className="text-xs text-forge-muted">
            Signs in-browser, broadcasts to SAYMAN, polls for the contract address.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-forge-muted">Fee policy</label>
          <select
            value={feePolicy}
            onChange={(e) => setFeePolicy(e.target.value as FeePolicy['policy'])}
            disabled={busy}
            className="rounded-lg border border-forge-border bg-forge-bg px-2 py-1.5 text-sm outline-none focus:border-forge-accent"
          >
            <option value="sponsor">sponsor (users pay nothing)</option>
            <option value="user">user</option>
            <option value="free">free</option>
          </select>
          <button onClick={run} disabled={!canDeploy || busy} className="btn btn-primary">
            {busy ? (
              <>
                <Spinner /> {stage === 'signing' ? 'Signing…' : stage === 'mempool' ? 'In mempool…' : 'Resolving…'}
              </>
            ) : stage === 'timeout' ? (
              'Re-check / Retry'
            ) : (
              'Deploy to SAYMAN'
            )}
          </button>
        </div>
      </div>

      {!canDeploy && (
        <p className="mt-3 text-xs text-forge-fail">
          Deploy is blocked — the validator found a FAIL-level issue. Fix the code above first.
        </p>
      )}

      <DeployProgress stage={stage} />

      {msg && (
        <p
          className={
            'mt-2 text-sm ' +
            (stage === 'need-funds' || stage === 'timeout'
              ? 'text-forge-warn'
              : busy
              ? 'text-forge-warn animate-forgepulse'
              : 'text-forge-muted')
          }
        >
          {msg}
        </p>
      )}
      {stage === 'need-funds' && (
        <button onClick={w.fund} className="btn btn-ghost mt-2 py-1.5">
          Fund session wallet
        </button>
      )}
      {txId && stage !== 'resolved' && (
        <p className="mono mt-2 text-xs text-forge-muted">txId: {txId}</p>
      )}
      {error && <p className="mt-2 text-sm text-forge-fail">{error}</p>}
    </div>
  );
}

function DeployProgress({ stage }: { stage: DeployStage }) {
  const steps = ['signing', 'mempool', 'polling', 'resolved'];
  const order: Record<string, number> = { signing: 0, mempool: 1, polling: 2, resolved: 3 };
  const current = order[stage] ?? -1;
  if (current < 0 && stage !== 'timeout') return null;
  const labels = ['Sign', 'Mempool', 'Next block', 'Resolved'];
  return (
    <div className="mt-3 flex items-center gap-1">
      {steps.map((s, i) => {
        const active = i <= current;
        return (
          <div key={s} className="flex flex-1 items-center gap-1">
            <div
              className={
                'flex-1 rounded-full py-1 text-center text-[11px] transition-colors ' +
                (active ? 'bg-forge-accent/20 text-forge-accent2' : 'bg-forge-bg text-forge-muted')
              }
            >
              {labels[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function friendlyDeployError(m?: string): string {
  const s = (m || '').toLowerCase();
  if (s.includes('signature') || s.includes('verify')) {
    return 'The chain rejected the signature. The wallet signing scheme may need adjustment (see sayman.ts).';
  }
  if (s.includes('nonce')) return 'Nonce conflict — refresh balance and try again.';
  if (s.includes('insufficient') || s.includes('balance')) return 'Insufficient balance for deploy gas. Fund the wallet.';
  if (s.includes('timed out') || s.includes('timeout')) return 'SAYMAN RPC timed out. Try again in a moment.';
  return m || 'Deploy failed.';
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
