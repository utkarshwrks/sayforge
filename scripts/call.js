// SAYMAN contract caller.
//
// Signs a CONTRACT_CALL transaction, broadcasts it (it lands in the mempool),
// then WAITS — polling the chain until a block mines the tx and the change is
// confirmed on-chain. Mirrors the in-browser call flow in
// client/src/lib/sayman.ts (same secp256k1 signing scheme).
//
//   Demo (tip the deployed TipJar 5 SAYN):
//       npm run call
//   Custom:
//       node scripts/call.js <contractAddress> <method> '<jsonArgs>'
//       node scripts/call.js 416fb84a...130f inc '{"by":3}'

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

secp.etc.hmacSha256Sync = (key, ...msgs) =>
  hmac(sha256, key, secp.etc.concatBytes(...msgs));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RPC = (process.env.SAYMAN_RPC || 'https://sayman.up.railway.app').replace(/\/+$/, '');
const API = `${RPC}/api`;
const DENOM = 100_000_000; // 1 SAYN = 100,000,000 base units

// ------------------------------- wallet / sign -------------------------------
function walletFromPrivate(pk) {
  const clean = pk.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('DEPLOYER_PRIVATE_KEY must be 64 hex chars.');
  const publicKey = bytesToHex(secp.getPublicKey(hexToBytes(clean), true));
  const address = bytesToHex(sha256(utf8ToBytes(publicKey))).slice(0, 40);
  return { privateKey: clean, publicKey, address };
}
const pad64 = (h) => (h.length >= 64 ? h : '0'.repeat(64 - h.length) + h);

function signTx({ wallet, type, data, timestamp, gasLimit, gasPrice, nonce }) {
  const payloadString = JSON.stringify({ type, timestamp, data, gasLimit, gasPrice, nonce });
  const sig = secp.sign(sha256(utf8ToBytes(payloadString)), wallet.privateKey);
  return {
    type, data, timestamp,
    signature: { r: pad64(sig.r.toString(16)), s: pad64(sig.s.toString(16)) },
    publicKey: wallet.publicKey, gasLimit, gasPrice, nonce,
  };
}

// ------------------------------- rpc -----------------------------------------
async function fetchT(url, opts = {}, ms = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}
async function rpcGet(p) {
  const res = await fetchT(`${API}/${p.replace(/^\/+/, '')}`);
  const txt = await res.text();
  const d = txt ? safeJson(txt) : null;
  if (!res.ok) throw new Error(errMsg(d) || `GET ${p} failed (${res.status})`);
  return d;
}
async function rpcPost(p, body) {
  const res = await fetchT(`${API}/${p.replace(/^\/+/, '')}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const txt = await res.text();
  const d = txt ? safeJson(txt) : null;
  if (!res.ok) throw new Error(errMsg(d) || `POST ${p} failed (${res.status})`);
  return d;
}
const safeJson = (t) => { try { return JSON.parse(t); } catch { return { raw: t }; } };
const errMsg = (d) => (!d ? null : d.error || d.message || (typeof d.raw === 'string' ? d.raw : null));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAccount(a) {
  const d = await rpcGet(`address/${a}`).catch(() => ({}));
  return { balance: Number(d?.balance ?? 0), nonce: Number(d?.nonce ?? 0) };
}
async function getContractState(addr) {
  // Returns the state object, or null if the contract is GONE (404 → chain reset).
  const res = await fetchT(`${API}/contracts/${addr.replace(/^\/+/, '')}`).catch(() => null);
  if (!res) return { unreachable: true };
  if (res.status === 404) return null;
  const txt = await res.text();
  const d = txt ? safeJson(txt) : null;
  const obj = d?.contract ?? d;
  if (!obj || obj.error) return {};
  for (const k of ['state', 'storage', 'data']) {
    const v = obj?.[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  }
  return {};
}

async function chainTip() {
  const d = await rpcGet('blocks').catch(() => null);
  const arr = Array.isArray(d) ? d : d?.blocks ?? [];
  const idx = arr.map((b) => Number(b.index)).filter((n) => !Number.isNaN(n));
  return idx.length ? Math.max(...idx) : null;
}

// --------------------------- resolve what to call ----------------------------
function resolveTarget() {
  const [, , addrArg, methodArg, argsArg] = process.argv;
  if (addrArg && methodArg) {
    let args = {};
    if (argsArg) { try { args = JSON.parse(argsArg); } catch { throw new Error(`args must be JSON, got: ${argsArg}`); } }
    return { address: addrArg.toLowerCase().replace(/^0x/, ''), method: methodArg, args };
  }
  // Default demo: tip the deployed TipJar 5 SAYN.
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments', 'sayman.json'), 'utf8'));
  const tipjar = rec.contracts.find((c) => c.name === 'TipJar' && c.address);
  if (!tipjar) throw new Error('No deployed TipJar in deployments/sayman.json — run `npm run deploy` first.');
  return { address: tipjar.address, method: 'tip', args: { amount: 5 * DENOM } };
}

// --------------------------------- main --------------------------------------
async function main() {
  const pk = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY is empty in .env — run `npm run deploy` first.');
  const wallet = walletFromPrivate(pk);
  const { address, method, args } = resolveTarget();

  console.log('\n  SAYMAN contract call');
  console.log(`  RPC      → ${RPC}`);
  console.log(`  Contract → ${address}`);
  console.log(`  Method   → ${method}(${JSON.stringify(args)})`);
  console.log(`  Caller   → ${wallet.address}\n`);

  const wait = process.argv.includes('--wait');
  const before = await getContractState(address);
  if (before === null) {
    console.log('  TipJar is not on this node (404) — the chain reset and wiped it.');
    console.log('  Run `npm run deploy` to redeploy, then `npm run call` again.\n');
    process.exitCode = 1;
    return;
  }
  console.log(`  State before : ${JSON.stringify(before)}`);

  // Broadcast the CONTRACT_CALL at the current nonce. Returns the nonce used, or
  // null if the broadcast was rejected (e.g. a tx is already pending at this nonce).
  async function submit() {
    const { nonce } = await getAccount(wallet.address);
    const signed = signTx({
      wallet,
      type: 'CONTRACT_CALL',
      data: { from: wallet.address, contractAddress: address, method, args },
      timestamp: Date.now(),
      gasLimit: 300_000,
      gasPrice: 1,
      nonce,
    });
    try {
      const res = await rpcPost('broadcast', signed);
      const txId = res?.txId ?? res?.txid ?? res?.hash ?? res?.id;
      console.log(`  → Broadcast at nonce ${nonce} — in the MEMPOOL. txId ${txId || '(none)'}`);
      return nonce;
    } catch (e) {
      // A pending tx already occupies this nonce — fine, it's still queued.
      console.log(`  → Already queued at nonce ${nonce} (${e.message}).`);
      return nonce;
    }
  }

  let submittedNonce = await submit();
  console.log('    Waiting for a block to mine it…\n');

  // Confirmation = our account nonce advances past the one we submitted (reliable
  // even if state readback lags). Survives a re-freeze (keep waiting) and a reset
  // (nonce rolls back below what we submitted → re-broadcast). One-shot mode gives
  // up after 5 min; --wait keeps the tx alive for up to 6 hours.
  const start = Date.now();
  const deadline = start + (wait ? 6 * 60 * 60_000 : 5 * 60_000);
  let mined = false;
  for (let i = 0; Date.now() < deadline; i++) {
    await sleep(4000);
    const state = await getContractState(address);
    if (state === null) {
      console.log('\n\n  The chain reset and wiped TipJar. Re-run `npm run deploy` then `npm run call`.\n');
      process.exitCode = 1;
      return;
    }
    const acct = await getAccount(wallet.address);
    if (acct.nonce > submittedNonce) { mined = true; break; }
    if (acct.nonce < submittedNonce) {
      // Reset cleared the mempool and rolled our nonce back — re-submit.
      console.log('\n  (chain rolled back — re-broadcasting the tip)');
      submittedNonce = await submit();
      continue;
    }
    if (i % 5 === 4) console.log(`    still pending in mempool… (${Math.round((Date.now() - start) / 1000)}s, chain tip #${await chainTip() ?? '?'})`);
    else process.stdout.write('.');
  }

  if (!mined) {
    console.log('\n\n  Not mined before the deadline — the chain is still frozen.');
    console.log('  The tx stays queued; run `npm run call -- --wait` to keep waiting.\n');
    process.exitCode = 1;
    return;
  }

  const after = await getContractState(address);
  console.log('\n\n  ✔ MINED and confirmed on-chain.');
  console.log(`  State before : ${JSON.stringify(before)}`);
  console.log(`  State after  : ${JSON.stringify(after ?? {})}`);
  console.log(`  View: ${API}/contracts/${address}\n`);
}

main().catch((e) => {
  console.error('\n  Call failed:', e.message, '\n');
  process.exitCode = 1;
});
