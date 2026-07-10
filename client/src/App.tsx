import { useEffect, useState } from 'react';
import { useWallet } from './hooks/useWallet';
import { generateContract, getServerConfig, type GeneratedContract } from './lib/api';
import WalletStrip from './components/WalletStrip';
import PromptScreen from './components/PromptScreen';
import ReviewScreen from './components/ReviewScreen';
import Footer from './components/Footer';
import type { DeployedInfo } from './components/DeployPanel';

type Screen = 'prompt' | 'review';

export default function App() {
  const w = useWallet();
  const [screen, setScreen] = useState<Screen>('prompt');
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [contract, setContract] = useState<GeneratedContract | null>(null);
  const [code, setCode] = useState('');
  const [lastDescription, setLastDescription] = useState('');
  const [deployed, setDeployed] = useState<DeployedInfo | null>(null);
  const [saymanRpc, setSaymanRpc] = useState('https://sayman.onrender.com');

  useEffect(() => {
    getServerConfig().then((c) => setSaymanRpc(c.saymanRpc)).catch(() => {});
  }, []);

  const doGenerate = async (description: string) => {
    setGenerating(true);
    setError('');
    setLastDescription(description);
    try {
      const c = await generateContract(description);
      setContract(c);
      setCode(c.code);
      setDeployed(null);
      setScreen('review');
    } catch (e: any) {
      setError(e?.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const doRegenerate = async () => {
    if (!lastDescription) return;
    setRegenerating(true);
    setError('');
    try {
      const c = await generateContract(lastDescription);
      setContract(c);
      setCode(c.code);
      setDeployed(null);
    } catch (e: any) {
      setError(e?.message || 'Regeneration failed.');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-forge-border bg-forge-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-forge-accent text-lg font-black text-[#1a0e05]">
              §
            </span>
            <div className="leading-tight">
              <div className="font-bold tracking-tight">SAYFORGE</div>
              <div className="text-[10px] uppercase tracking-widest text-forge-muted">
                AI contract studio · SAYMAN
              </div>
            </div>
          </div>
          <div className="ml-auto hidden text-xs text-forge-muted sm:block">testnet</div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6">
          <WalletStrip w={w} />
        </div>

        {screen === 'prompt' || !contract ? (
          <PromptScreen onGenerate={doGenerate} generating={generating} error={error} />
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-lg border border-forge-fail/40 bg-forge-fail/10 px-4 py-3 text-sm text-forge-fail">
                {error}
              </div>
            )}
            <ReviewScreen
              w={w}
              contract={contract}
              code={code}
              onCodeChange={setCode}
              onRegenerate={doRegenerate}
              onBack={() => {
                setScreen('prompt');
                setError('');
              }}
              regenerating={regenerating}
              saymanRpc={saymanRpc}
              deployed={deployed}
              onDeployed={setDeployed}
              onRedeploy={() => {
                setDeployed(null);
                w.refreshBalance();
              }}
            />
          </>
        )}

        <Footer />
      </main>
    </div>
  );
}
