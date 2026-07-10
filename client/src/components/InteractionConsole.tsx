import { useCallback, useEffect, useState } from 'react';
import type { UseWallet } from '../hooks/useWallet';
import type { ContractMethod, MethodArg } from '../lib/api';
import {
  callContract,
  getContract,
  readContract,
  pollContractState,
  type ContractObject,
} from '../lib/sayman';

export default function InteractionConsole({
  w,
  address,
  methods,
  onRedeploy,
}: {
  w: UseWallet;
  address: string;
  methods: ContractMethod[];
  onRedeploy?: () => void;
}) {
  const [contract, setContract] = useState<ContractObject | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [wiped, setWiped] = useState(false);

  const loadState = useCallback(async () => {
    setLoadingState(true);
    const { status, contract: c } = await readContract(address);
    if (status === 'not_found') {
      setWiped(true);
    } else if (status === 'ok' && c) {
      setWiped(false);
      setContract(c);
    }
    setLoadingState(false);
  }, [address]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  return (
    <div className="space-y-4">
      {wiped && <ResetBanner onRedeploy={onRedeploy} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-forge-text">Interaction console</h3>
        {methods.length === 0 && (
          <p className="text-sm text-forge-muted">No methods were described for this contract.</p>
        )}
        {methods.map((m) => (
          <MethodCard
            key={m.name}
            w={w}
            address={address}
            method={m}
            onStateMaybeChanged={loadState}
            onWiped={() => setWiped(true)}
          />
        ))}
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Live contract state</h3>
            <button
              onClick={loadState}
              className="text-xs text-forge-accent hover:underline"
              disabled={loadingState}
            >
              {loadingState ? 'refreshing…' : 'refresh'}
            </button>
          </div>
          <pre className="mono max-h-[420px] overflow-auto rounded-lg bg-forge-bg p-3 text-xs leading-5 text-forge-text">
{JSON.stringify(contract?.state ?? {}, null, 2)}
          </pre>
        </div>
      </div>
      </div>
    </div>
  );
}

function ResetBanner({ onRedeploy }: { onRedeploy?: () => void }) {
  return (
    <div className="rounded-xl border border-forge-warn/50 bg-forge-warn/10 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg">♻️</span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-forge-warn">SAYMAN testnet reset — contract wiped</p>
          <p className="mt-0.5 text-xs text-forge-muted">
            The public testnet (a free instance) periodically resets its state, erasing deployed
            contracts, balances, and nonces. Your deploy was valid and landed on-chain; the node
            simply rolled back. Re-fund if needed, then redeploy to get a fresh live contract.
          </p>
        </div>
        {onRedeploy && (
          <button onClick={onRedeploy} className="btn btn-primary py-1.5">
            Redeploy
          </button>
        )}
      </div>
    </div>
  );
}

function coerce(arg: MethodArg, raw: string): unknown {
  if (arg.type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (arg.type === 'boolean') return raw === 'true' || raw === '1';
  return raw; // string | address
}

function MethodCard({
  w,
  address,
  method,
  onStateMaybeChanged,
  onWiped,
}: {
  w: UseWallet;
  address: string;
  method: ContractMethod;
  onStateMaybeChanged: () => void;
  onWiped: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<string>('');

  const setArg = (name: string, value: string) => setInputs((p) => ({ ...p, [name]: value }));

  const buildArgs = () => {
    const out: Record<string, unknown> = {};
    for (const a of method.args) out[a.name] = coerce(a, inputs[a.name] ?? '');
    return out;
  };

  const runRead = async () => {
    setStatus('busy');
    setMsg('Reading state…');
    setResult('');
    try {
      const { status: rs, contract: c } = await readContract(address);
      if (rs === 'not_found') {
        onWiped();
        setStatus('error');
        setMsg('Contract no longer on-chain — the testnet reset. Redeploy from the banner above.');
        return;
      }
      // For read-only methods we surface the whole state; if a same-named state key
      // exists we highlight it as the likely return value.
      const state = c?.state ?? {};
      const key = Object.keys(state).find((k) => k.toLowerCase() === method.name.toLowerCase());
      setResult(JSON.stringify(key ? { [key]: (state as any)[key], state } : state, null, 2));
      setStatus('ok');
      setMsg('');
    } catch (e: any) {
      setStatus('error');
      setMsg(e?.message || 'Read failed.');
    }
  };

  const runWrite = async () => {
    if (!w.wallet) return;
    if (w.balance <= 0) {
      setStatus('error');
      setMsg('Fund the session wallet first — calls cost gas.');
      return;
    }
    setStatus('busy');
    setResult('');
    try {
      const prev = await getContract(address).catch(() => null);
      const prevStateJson = JSON.stringify(prev?.state ?? {});

      setMsg('Signing call in your browser…');
      const nonce = await w.nextNonce();
      const timestamp = Date.now();
      const res = await callContract({
        wallet: w.wallet,
        contractAddress: address,
        method: method.name,
        args: buildArgs(),
        nonce,
        timestamp,
      });

      setMsg('Queued in mempool — waiting for the next block and polling state…');
      const updated = await pollContractState(address, {
        prevStateJson,
        timeoutMs: 16000,
        intervalMs: 1500,
      });

      // If the contract vanished while we polled, the testnet reset mid-call.
      const after = await readContract(address);
      if (after.status === 'not_found') {
        onWiped();
        setStatus('error');
        setMsg('The testnet reset mid-call and wiped the contract. Redeploy from the banner above.');
        return;
      }

      const changed = updated && JSON.stringify(updated.state ?? {}) !== prevStateJson;
      setResult(
        JSON.stringify(
          { txId: res.txId, stateChanged: Boolean(changed), state: updated?.state ?? {} },
          null,
          2
        )
      );
      setStatus('ok');
      setMsg(changed ? 'Confirmed — state updated.' : 'Broadcast sent; state not yet changed (still pending?).');
      onStateMaybeChanged();
      w.refreshBalance();
    } catch (e: any) {
      setStatus('error');
      setMsg(e?.message || 'Call failed.');
    }
  };

  const busy = status === 'busy';

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="mono font-semibold text-forge-text">{method.name}</span>
          <span
            className={
              'ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ' +
              (method.stateChanging
                ? 'bg-forge-accent/15 text-forge-accent2'
                : 'bg-forge-ok/15 text-forge-ok')
            }
          >
            {method.stateChanging ? 'write' : 'read'}
          </span>
        </div>
        <button
          onClick={method.stateChanging ? runWrite : runRead}
          disabled={busy}
          className={method.stateChanging ? 'btn btn-primary py-1.5' : 'btn btn-ghost py-1.5'}
        >
          {busy ? <Spinner /> : method.stateChanging ? 'Call' : 'Read'}
        </button>
      </div>

      {method.description && <p className="mt-1 text-xs text-forge-muted">{method.description}</p>}

      {method.args.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {method.args.map((a) => (
            <label key={a.name} className="block">
              <span className="mono text-[11px] text-forge-muted">
                {a.name} <span className="text-forge-border">: {a.type}</span>
              </span>
              {a.type === 'boolean' ? (
                <select
                  value={inputs[a.name] ?? 'false'}
                  onChange={(e) => setArg(a.name, e.target.value)}
                  className="mono mt-1 w-full rounded-lg border border-forge-border bg-forge-bg px-2 py-1.5 text-sm outline-none focus:border-forge-accent"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  value={inputs[a.name] ?? ''}
                  onChange={(e) => setArg(a.name, e.target.value)}
                  inputMode={a.type === 'number' ? 'numeric' : 'text'}
                  placeholder={a.type === 'address' ? '40-hex address' : a.type}
                  className="mono mt-1 w-full rounded-lg border border-forge-border bg-forge-bg px-2 py-1.5 text-sm outline-none focus:border-forge-accent"
                />
              )}
            </label>
          ))}
        </div>
      )}

      {msg && (
        <p
          className={
            'mt-2 text-xs ' +
            (status === 'error'
              ? 'text-forge-fail'
              : busy
              ? 'text-forge-warn animate-forgepulse'
              : 'text-forge-ok')
          }
        >
          {msg}
        </p>
      )}
      {result && (
        <pre className="mono mt-2 max-h-56 overflow-auto rounded-lg bg-forge-bg p-2 text-[11px] leading-5 text-forge-text">
{result}
        </pre>
      )}
    </div>
  );
}

function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
