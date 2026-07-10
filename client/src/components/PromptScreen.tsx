import { useState } from 'react';

const EXAMPLES = [
  'a tip jar where anyone can tip the owner and the owner can withdraw',
  'a 3-option poll where each address can vote only once',
  'a simple registry mapping names to values',
  'a counter that anyone can increment',
  'an ERC20-style token with mint restricted to the owner',
];

export default function PromptScreen({
  onGenerate,
  generating,
  error,
}: {
  onGenerate: (description: string) => void;
  generating: boolean;
  error?: string;
}) {
  const [text, setText] = useState('');

  const submit = () => {
    const t = text.trim();
    if (t && !generating) onGenerate(t);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Describe it. <span className="text-forge-accent">Deploy it.</span>
        </h1>
        <p className="mt-3 text-forge-muted">
          On-chain in 30 seconds — no Solidity, no setup. One sentence in, a live SAYMAN dApp out.
        </p>
      </div>

      <div className="card p-4 shadow-glow">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
          }}
          placeholder="Describe the contract you want…  (⌘/Ctrl + Enter to generate)"
          rows={4}
          className="w-full resize-y rounded-lg border border-forge-border bg-forge-bg px-4 py-3 text-base outline-none focus:border-forge-accent"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-xs text-forge-muted">
            Groq generates a SAYMAN JS contract, then SAYFORGE validates it before you deploy.
          </span>
          <button onClick={submit} disabled={!text.trim() || generating} className="btn btn-primary">
            {generating ? (
              <>
                <Spinner /> Generating…
              </>
            ) : (
              'Generate contract'
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-forge-fail/40 bg-forge-fail/10 px-4 py-3 text-sm text-forge-fail">
          {error}
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-xs uppercase tracking-wide text-forge-muted">Try one</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => setText(ex)} disabled={generating}>
              {ex}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}
