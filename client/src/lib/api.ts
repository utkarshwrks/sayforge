// Calls to our own Express backend (Groq proxy + config).

export interface MethodArg {
  name: string;
  type: 'number' | 'string' | 'boolean' | 'address';
}

export interface ContractMethod {
  name: string;
  description: string;
  stateChanging: boolean;
  args: MethodArg[];
}

export interface GeneratedContract {
  contractName: string;
  code: string;
  summary: string;
  methods: ContractMethod[];
}

export async function generateContract(description: string): Promise<GeneratedContract> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(friendlyGenerateError(data, res.status));
  }
  return data as GeneratedContract;
}

function friendlyGenerateError(data: any, status: number): string {
  const code = data?.code;
  if (code === 'NO_KEY') return 'Server has no GROQ_API_KEY set. Add it to the environment and restart.';
  if (code === 'BAD_KEY') return 'Groq rejected the API key. Double-check GROQ_API_KEY.';
  if (code === 'RATE_LIMIT') return 'Groq is rate-limiting. Wait a few seconds and try again.';
  if (data?.error) return data.error;
  return `Generation failed (HTTP ${status}).`;
}

export async function getServerConfig(): Promise<{ saymanRpc: string }> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error();
    return await res.json();
  } catch {
    return { saymanRpc: 'https://sayman.up.railway.app' };
  }
}
