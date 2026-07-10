import { useMemo } from 'react';
import type { UseWallet } from '../hooks/useWallet';
import type { GeneratedContract } from '../lib/api';
import { validateContract } from '../lib/validator';
import CodeEditor from './CodeEditor';
import ValidatorPanel from './ValidatorPanel';
import DeployPanel, { type DeployedInfo } from './DeployPanel';
import InteractionConsole from './InteractionConsole';

export default function ReviewScreen({
  w,
  contract,
  code,
  onCodeChange,
  onRegenerate,
  onBack,
  regenerating,
  saymanRpc,
  deployed,
  onDeployed,
}: {
  w: UseWallet;
  contract: GeneratedContract;
  code: string;
  onCodeChange: (v: string) => void;
  onRegenerate: () => void;
  onBack: () => void;
  regenerating: boolean;
  saymanRpc: string;
  deployed: DeployedInfo | null;
  onDeployed: (info: DeployedInfo) => void;
}) {
  const validation = useMemo(() => validateContract(code), [code]);
  const canDeploy = validation.level !== 'fail';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="text-sm text-forge-muted hover:text-white">
              ← New prompt
            </button>
          </div>
          <h2 className="mono mt-1 text-2xl font-bold text-forge-text">{contract.contractName}</h2>
          {contract.summary && <p className="mt-1 max-w-2xl text-sm text-forge-muted">{contract.summary}</p>}
        </div>
        <button onClick={onRegenerate} disabled={regenerating} className="btn btn-ghost">
          {regenerating ? 'Regenerating…' : '↻ Regenerate'}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-forge-muted">Contract source (editable)</span>
            <span className="mono text-[11px] text-forge-muted">{code.length} bytes</span>
          </div>
          <CodeEditor value={code} onChange={onCodeChange} height={420} />
        </div>

        <div className="space-y-4">
          <ValidatorPanel result={validation} />
          <DeployPanel
            w={w}
            contractName={contract.contractName}
            code={code}
            canDeploy={canDeploy}
            saymanRpc={saymanRpc}
            deployed={deployed}
            onDeployed={onDeployed}
          />
        </div>
      </div>

      {deployed && (
        <div className="border-t border-forge-border pt-5">
          <InteractionConsole w={w} address={deployed.address} methods={contract.methods} />
        </div>
      )}
    </div>
  );
}
