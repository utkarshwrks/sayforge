const STEPS = ['prompt', 'Groq', 'validate', 'sign in-browser', 'broadcast', 'poll'];

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-forge-border pt-5 text-center">
      <p className="text-xs uppercase tracking-wide text-forge-muted">How it works</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-1 text-sm text-forge-text">
        {STEPS.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <span className="mono rounded-md bg-forge-panel px-2 py-1 text-xs">{s}</span>
            {i < STEPS.length - 1 && <span className="text-forge-accent">→</span>}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-forge-muted">
        The Groq API key never touches the browser. Contracts are signed client-side with
        secp256k1 and broadcast straight to the SAYMAN public testnet.
      </p>
    </footer>
  );
}
