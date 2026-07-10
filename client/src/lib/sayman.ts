// SAYMAN chain client — wallet, signing, broadcast, deploy, call, read.
//
// Signing scheme (must match the chain exactly or broadcasts are rejected):
//  - Keypair: secp256k1, generated in-browser. The private key never leaves the client.
//  - Address = first 40 hex chars of SHA-256(publicKeyHex).
//  - payloadString = JSON.stringify({ type, timestamp, data, gasLimit, gasPrice, nonce })
//    with keys in THAT exact order.
//  - signature = ECDSA secp256k1 over SHA-256(payloadString), returned as { r, s } hex.
//  - The broadcast body also carries publicKey (hex); the server re-derives the address
//    from it and rejects a mismatch with data.from.

import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

// Enable synchronous signing in noble v2.
secp.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
  hmac(sha256, key, secp.etc.concatBytes(...msgs));

// The chain derives the address from whatever publicKey encoding we send, so the
// only hard requirement is that we stay internally consistent. We use compressed
// hex. If the SAYMAN node expects uncompressed keys, flip this single flag.
const PUBKEY_COMPRESSED = true;

// Default denomination: 1 SAYN = 100,000,000 base units (8 decimals).
export const DEFAULT_DENOMINATION = 100_000_000;

// -------- API base --------
// The browser talks to our own /api/rpc proxy, which forwards to SAYMAN_RPC.
// This keeps everything on one origin (no CORS) while still requiring no key.
const RPC_BASE = '/api/rpc';

// ---------------- types ----------------
export type Hex = string;

export interface Wallet {
  privateKey: Hex;
  publicKey: Hex;
  address: Hex;
}

export interface Signature {
  r: Hex;
  s: Hex;
}

export type TxType =
  | 'TRANSFER'
  | 'STAKE'
  | 'UNSTAKE'
  | 'CONTRACT_DEPLOY'
  | 'CONTRACT_CALL';

export interface AccountInfo {
  balance: number;
  stake: number;
  nonce: number;
  reputation?: number;
  [k: string]: unknown;
}

export interface ContractObject {
  address: string;
  name?: string;
  version?: string;
  state?: Record<string, unknown>;
  abi?: unknown;
  [k: string]: unknown;
}

export interface FeePolicy {
  policy: 'sponsor' | 'user' | 'free';
}

// ---------------- low-level helpers ----------------
function pad64(hex: string): string {
  return hex.length >= 64 ? hex : '0'.repeat(64 - hex.length) + hex;
}

function bigToHex(n: bigint): string {
  return pad64(n.toString(16));
}

async function rpcGet<T = any>(pathname: string): Promise<T> {
  const res = await fetch(`${RPC_BASE}/${pathname.replace(/^\/+/, '')}`);
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new Error(errMsg(data) || `RPC GET ${pathname} failed (${res.status})`);
  }
  return data as T;
}

async function rpcPost<T = any>(pathname: string, body: unknown): Promise<T> {
  const res = await fetch(`${RPC_BASE}/${pathname.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    throw new Error(errMsg(data) || `RPC POST ${pathname} failed (${res.status})`);
  }
  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function errMsg(data: any): string | null {
  if (!data) return null;
  return data.error || data.message || (typeof data.raw === 'string' ? data.raw : null);
}

// ---------------- wallet ----------------
export function createWallet(): Wallet {
  const priv = secp.utils.randomPrivateKey();
  return walletFromPrivate(bytesToHex(priv));
}

export function walletFromPrivate(privateKeyHex: Hex): Wallet {
  const clean = privateKeyHex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('Private key must be 64 hex characters.');
  }
  const priv = hexToBytes(clean);
  const pub = secp.getPublicKey(priv, PUBKEY_COMPRESSED);
  const publicKey = bytesToHex(pub);
  const address = deriveAddress(publicKey);
  return { privateKey: clean, publicKey, address };
}

// Address = first 40 hex chars of SHA-256(publicKeyHex).
export function deriveAddress(publicKeyHex: Hex): Hex {
  const digest = sha256(utf8ToBytes(publicKeyHex));
  return bytesToHex(digest).slice(0, 40);
}

// ---------------- signing ----------------
export interface SignedTx {
  type: TxType;
  data: Record<string, unknown>;
  timestamp: number;
  signature: Signature;
  publicKey: Hex;
  gasLimit: number;
  gasPrice: number;
  nonce: number;
}

/**
 * Build the canonical payload, hash it, sign it, and assemble the broadcast body.
 * Key order in payloadString is fixed: type, timestamp, data, gasLimit, gasPrice, nonce.
 */
export function signTx(params: {
  wallet: Wallet;
  type: TxType;
  data: Record<string, unknown>;
  timestamp: number;
  gasLimit: number;
  gasPrice: number;
  nonce: number;
}): SignedTx {
  const { wallet, type, data, timestamp, gasLimit, gasPrice, nonce } = params;

  const payloadString = JSON.stringify({
    type,
    timestamp,
    data,
    gasLimit,
    gasPrice,
    nonce,
  });

  const msgHash = sha256(utf8ToBytes(payloadString));
  const sig = secp.sign(msgHash, wallet.privateKey); // sync (hmac set above)

  const signature: Signature = { r: bigToHex(sig.r), s: bigToHex(sig.s) };

  return {
    type,
    data,
    timestamp,
    signature,
    publicKey: wallet.publicKey,
    gasLimit,
    gasPrice,
    nonce,
  };
}

// ---------------- reads ----------------
export async function getDenomination(): Promise<number> {
  try {
    const d = await rpcGet<any>('denomination');
    // The live node returns { decimals: 100000000, ... } where `decimals` is the
    // base-unit multiplier (not a power). Accept several field names, and if a
    // small value shows up (e.g. 8) treat it as an exponent (10^8).
    const raw =
      typeof d === 'number'
        ? d
        : d?.denomination ?? d?.baseUnits ?? d?.decimals ?? d?.value ?? d?.subunits;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_DENOMINATION;
    return value <= 18 ? 10 ** value : value;
  } catch {
    return DEFAULT_DENOMINATION;
  }
}

export async function getAccount(address: Hex): Promise<AccountInfo> {
  const d = await rpcGet<any>(`address/${address}`);
  return {
    balance: Number(d?.balance ?? 0),
    stake: Number(d?.stake ?? 0),
    nonce: Number(d?.nonce ?? 0),
    reputation: d?.reputation != null ? Number(d.reputation) : undefined,
    ...d,
  };
}

export async function getBalance(address: Hex): Promise<number> {
  try {
    const d = await rpcGet<any>(`balance/${address}`);
    const value = typeof d === 'number' ? d : d?.balance ?? d?.value ?? 0;
    return Number(value) || 0;
  } catch {
    // Fall back to the account endpoint if a dedicated balance route is absent.
    const acct = await getAccount(address);
    return acct.balance;
  }
}

export async function getNonce(address: Hex): Promise<number> {
  try {
    const acct = await getAccount(address);
    return acct.nonce || 0;
  } catch {
    return 0;
  }
}

export type ContractReadStatus = 'ok' | 'not_found' | 'error';

// Rich read that distinguishes a genuine "contract not found" (the SAYMAN testnet
// reset and wiped it) from a transient network/RPC error. The UI uses this to tell
// a reset apart from an ordinary hiccup.
export async function readContract(
  address: Hex
): Promise<{ status: ContractReadStatus; contract: ContractObject | null }> {
  try {
    const res = await fetch(`${RPC_BASE}/contracts/${address.replace(/^\/+/, '')}`);
    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (res.status === 404) return { status: 'not_found', contract: null };
    if (!res.ok) return { status: 'error', contract: null };

    const obj = data?.contract ?? data;
    // Some nodes answer 200 with an error/string body when the contract is gone.
    const asMsg = (obj?.error ?? (typeof obj === 'string' ? obj : '') ?? '')
      .toString()
      .toLowerCase();
    if (!obj || obj.error || typeof obj === 'string') {
      if (asMsg.includes('not found')) return { status: 'not_found', contract: null };
      return { status: 'error', contract: null };
    }
    return { status: 'ok', contract: { address, ...obj } as ContractObject };
  } catch {
    return { status: 'error', contract: null };
  }
}

export async function getContract(address: Hex): Promise<ContractObject | null> {
  const { contract } = await readContract(address);
  return contract;
}

export async function listContracts(): Promise<ContractObject[]> {
  const d = await rpcGet<any>('contracts');
  const arr = Array.isArray(d) ? d : d?.contracts ?? d?.items ?? [];
  return (arr as any[]).map((c) => ({ address: c.address, ...c }));
}

// ---------------- faucet ----------------
export async function requestFaucet(address: Hex): Promise<void> {
  await rpcPost('faucet', { address });
}

// ---------------- writes ----------------
export async function broadcast(signed: SignedTx): Promise<{ txId?: string; [k: string]: unknown }> {
  const d = await rpcPost<any>('broadcast', signed);
  return { txId: d?.txId ?? d?.txid ?? d?.hash ?? d?.id, ...d };
}

// Deploy gas: 200,000 + 1 gas per 10 bytes of source, plus a buffer.
export function deployGasLimit(code: string): number {
  return 200_000 + Math.ceil(code.length / 10) + 50_000;
}

export interface DeployParams {
  wallet: Wallet;
  name: string;
  code: string;
  version?: string;
  abi?: unknown;
  feePolicy?: FeePolicy['policy'];
  nonce: number;
  timestamp: number;
}

export async function deployContract(p: DeployParams) {
  const data = {
    from: p.wallet.address,
    name: p.name,
    version: p.version || '1.0.0',
    abi: p.abi ?? null,
    feePolicy: p.feePolicy || 'sponsor',
    code: p.code,
  };
  const signed = signTx({
    wallet: p.wallet,
    type: 'CONTRACT_DEPLOY',
    data,
    timestamp: p.timestamp,
    gasLimit: deployGasLimit(p.code),
    gasPrice: 1,
    nonce: p.nonce,
  });
  return broadcast(signed);
}

export interface CallParams {
  wallet: Wallet;
  contractAddress: Hex;
  method: string;
  args: Record<string, unknown>;
  nonce: number;
  timestamp: number;
}

export async function callContract(p: CallParams) {
  const data = {
    from: p.wallet.address,
    contractAddress: p.contractAddress,
    method: p.method,
    args: p.args,
  };
  const signed = signTx({
    wallet: p.wallet,
    type: 'CONTRACT_CALL',
    data,
    timestamp: p.timestamp,
    gasLimit: 300_000,
    gasPrice: 1,
    nonce: p.nonce,
  });
  return broadcast(signed);
}

export interface TransferParams {
  wallet: Wallet;
  to: Hex;
  amount: number; // base units
  nonce: number;
  timestamp: number;
}

export async function transfer(p: TransferParams) {
  const data = { from: p.wallet.address, to: p.to, amount: p.amount };
  const signed = signTx({
    wallet: p.wallet,
    type: 'TRANSFER',
    data,
    timestamp: p.timestamp,
    gasLimit: 100_000,
    gasPrice: 1,
    nonce: p.nonce,
  });
  return broadcast(signed);
}

// ---------------- polling helpers ----------------
export async function pollBalanceUntilFunded(
  address: Hex,
  opts: { timeoutMs?: number; intervalMs?: number; onTick?: (b: number) => void } = {}
): Promise<number> {
  const timeout = opts.timeoutMs ?? 30_000;
  const interval = opts.intervalMs ?? 2000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const b = await getBalance(address).catch(() => 0);
    opts.onTick?.(b);
    if (b > 0) return b;
    await sleep(interval);
  }
  return 0;
}

export async function pollForContractByName(
  name: string,
  opts: { timeoutMs?: number; intervalMs?: number; sinceAddresses?: Set<string> } = {}
): Promise<ContractObject | null> {
  const timeout = opts.timeoutMs ?? 20_000;
  const interval = opts.intervalMs ?? 2500;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const contracts = await listContracts();
      // Prefer a contract whose name matches AND that wasn't present before deploy.
      const matches = contracts.filter((c) => c.name === name);
      const fresh = opts.sinceAddresses
        ? matches.find((c) => !opts.sinceAddresses!.has(c.address))
        : matches[matches.length - 1];
      if (fresh) return fresh;
      // Registry entries may not carry a top-level `name`. Fall back: if exactly
      // one contract appeared since our pre-deploy snapshot, that's ours.
      if (opts.sinceAddresses && matches.length === 0) {
        const appeared = contracts.filter((c) => !opts.sinceAddresses!.has(c.address));
        if (appeared.length === 1) return appeared[0];
      }
    } catch {
      /* keep polling */
    }
    await sleep(interval);
  }
  return null;
}

// Poll a contract's state, resolving when it changes vs. the given snapshot
// (or after the timeout, returning whatever we last read).
export async function pollContractState(
  address: Hex,
  opts: {
    prevStateJson?: string;
    timeoutMs?: number;
    intervalMs?: number;
    onTick?: (c: ContractObject) => void;
  } = {}
): Promise<ContractObject | null> {
  const timeout = opts.timeoutMs ?? 15_000;
  const interval = opts.intervalMs ?? 1500;
  const start = Date.now();
  let last: ContractObject | null = null;
  while (Date.now() - start < timeout) {
    const c = await getContract(address).catch(() => null);
    if (c) {
      last = c;
      opts.onTick?.(c);
      if (opts.prevStateJson != null) {
        const now = JSON.stringify(c.state ?? {});
        if (now !== opts.prevStateJson) return c;
      }
    }
    await sleep(interval);
  }
  return last;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------- amount formatting ----------------
export function formatSayn(baseUnits: number, denomination = DEFAULT_DENOMINATION): string {
  const v = baseUnits / denomination;
  return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

export function toBaseUnits(sayn: number, denomination = DEFAULT_DENOMINATION): number {
  return Math.round(sayn * denomination);
}

// Link to endpoints that are guaranteed to resolve on the SAYMAN node. The
// contract registry object (with code + state) lives at /api/contracts/:address.
export function explorerContractUrl(base: string, address: string): string {
  return `${base}/api/contracts/${address}`;
}

export function explorerTxUrl(base: string, _txId: string): string {
  // No per-tx route is documented; the recent blocks feed is the closest public view.
  return `${base}/api/blocks`;
}
