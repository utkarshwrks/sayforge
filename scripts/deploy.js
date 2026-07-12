// SAYMAN chain deployer.
//
// Signs CONTRACT_DEPLOY transactions and broadcasts them to the SAYMAN testnet,
// then polls the chain for each contract's on-chain address. This is the
// server-side / CLI counterpart to the in-browser deploy flow in
// client/src/lib/sayman.ts — the signing scheme is byte-for-byte identical, so
// contracts deployed here are indistinguishable from ones deployed in the app.
//
//   Usage:  node scripts/deploy.js
//           npm run deploy
//
// The deployer wallet is read from DEPLOYER_PRIVATE_KEY in .env. If that is
// empty, a fresh wallet is generated and saved back to .env for you — then fund
// its printed address with a little SAYN (or let the built-in faucet try) and
// run again.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

// noble v2 needs a sync HMAC to sign synchronously — same shim the client uses.
secp.etc.hmacSha256Sync = (key, ...msgs) =>
  hmac(sha256, key, secp.etc.concatBytes(...msgs));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const CONTRACTS_DIR = path.join(ROOT, 'contracts');
const OUT_DIR = path.join(ROOT, 'deployments');

const RPC = (process.env.SAYMAN_RPC || 'https://sayman.onrender.com').replace(/\/+$/, '');
const API = `${RPC}/api`;
const PUBKEY_COMPRESSED = true;
const DENOMINATION = 100_000_000; // 1 SAYN = 100,000,000 base units

// The reference contracts to deploy, in order. Their source is read verbatim
// from contracts/<file> and deployed as-is.
const CONTRACTS = [
  { file: 'TipJar.js', name: 'TipJar' },
  { file: 'Counter.js', name: 'Counter' },
  { file: 'Poll3.js', name: 'Poll3' },
];

// ------------------------------- wallet --------------------------------------
function walletFromPrivate(privateKeyHex) {
  const clean = privateKeyHex.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('DEPLOYER_PRIVATE_KEY must be 64 hex characters.');
  }
  const pub = secp.getPublicKey(hexToBytes(clean), PUBKEY_COMPRESSED);
  const publicKey = bytesToHex(pub);
  // Address = first 40 hex chars of SHA-256(publicKeyHex).
  const address = bytesToHex(sha256(utf8ToBytes(publicKey))).slice(0, 40);
  return { privateKey: clean, publicKey, address };
}

function createWallet() {
  return walletFromPrivate(bytesToHex(secp.utils.randomPrivateKey()));
}

// ------------------------------- signing -------------------------------------
function pad64(hex) {
  return hex.length >= 64 ? hex : '0'.repeat(64 - hex.length) + hex;
}

function signTx({ wallet, type, data, timestamp, gasLimit, gasPrice, nonce }) {
  // Canonical payload — key order is fixed and must match the chain exactly.
  const payloadString = JSON.stringify({ type, timestamp, data, gasLimit, gasPrice, nonce });
  const sig = secp.sign(sha256(utf8ToBytes(payloadString)), wallet.privateKey);
  return {
    type,
    data,
    timestamp,
    signature: { r: pad64(sig.r.toString(16)), s: pad64(sig.s.toString(16)) },
    publicKey: wallet.publicKey,
    gasLimit,
    gasPrice,
    nonce,
  };
}

function deployGasLimit(code) {
  return 200_000 + Math.ceil(code.length / 10) + 50_000;
}

// ------------------------------- rpc -----------------------------------------
// fetch with a hard timeout — the public nodes (free tier) can be slow or hang.
async function fetchT(url, opts = {}, ms = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function rpcGet(pathname) {
  const res = await fetchT(`${API}/${pathname.replace(/^\/+/, '')}`);
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new Error(errMsg(data) || `GET ${pathname} failed (${res.status})`);
  return data;
}

async function rpcPost(pathname, body) {
  const res = await fetchT(`${API}/${pathname.replace(/^\/+/, '')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new Error(errMsg(data) || `POST ${pathname} failed (${res.status})`);
  return data;
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}
function errMsg(d) {
  if (!d) return null;
  return d.error || d.message || (typeof d.raw === 'string' ? d.raw : null);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getAccount(address) {
  const d = await rpcGet(`address/${address}`).catch(() => ({}));
  return { balance: Number(d?.balance ?? 0), nonce: Number(d?.nonce ?? 0) };
}

async function getBalance(address) {
  try {
    const d = await rpcGet(`balance/${address}`);
    const v = typeof d === 'number' ? d : d?.balance ?? d?.value ?? 0;
    return Number(v) || 0;
  } catch {
    return (await getAccount(address)).balance;
  }
}

async function listContracts() {
  const d = await rpcGet('contracts').catch(() => []);
  const arr = Array.isArray(d) ? d : d?.contracts ?? d?.items ?? [];
  return arr.map((c) => ({ address: c.address, name: c.name, ...c }));
}

async function requestFaucet(address) {
  return rpcPost('faucet', { address });
}

// Highest block index the node currently reports.
async function chainTip() {
  const d = await rpcGet('blocks').catch(() => null);
  const arr = Array.isArray(d) ? d : d?.blocks ?? [];
  const idx = arr.map((b) => Number(b.index)).filter((n) => !Number.isNaN(n));
  return idx.length ? Math.max(...idx) : null;
}

// A SAYMAN transaction only settles when a NEW block is produced. On the public
// testnet the block producer sometimes stops (the chain "freezes"): the faucet
// and deploys are accepted into the mempool but never confirm. Detect that up
// front so we don't generate wallets and hang. With `wait`, keep polling until
// the tip advances (up to 20 min) and auto-proceed the moment it recovers.
async function waitForLiveChain(wait) {
  const first = await chainTip();
  console.log(`  Chain tip: block #${first ?? '?'}`);
  if (first == null) {
    console.log('  Could not read the chain tip — the node may be unreachable.\n');
    return false;
  }
  const deadline = Date.now() + (wait ? 20 * 60_000 : 14_000);
  while (Date.now() < deadline) {
    await sleep(wait ? 10_000 : 7_000);
    const now = await chainTip();
    if (now != null && now > first) {
      console.log(`  Chain is LIVE — advanced to #${now}. Proceeding.\n`);
      return true;
    }
    if (wait) console.log(`  still frozen at #${now ?? '?'} — waiting for the SAYMAN node to resume…`);
  }
  return false;
}

async function broadcast(signed) {
  const d = await rpcPost('broadcast', signed);
  return { txId: d?.txId ?? d?.txid ?? d?.hash ?? d?.id, ...d };
}

// --------------------------- deploy helpers ----------------------------------
async function pollForContractByName(name, sinceAddresses, timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const contracts = await listContracts().catch(() => []);
    const matches = contracts.filter((c) => c.name === name);
    const fresh = matches.find((c) => !sinceAddresses.has(c.address));
    if (fresh) return fresh;
    // Registry entries may omit a top-level name: if exactly one contract is
    // new since our snapshot, that's ours.
    if (matches.length === 0) {
      const appeared = contracts.filter((c) => !sinceAddresses.has(c.address));
      if (appeared.length === 1) return appeared[0];
    }
    await sleep(2500);
  }
  return null;
}

function fmtSayn(base) {
  return (base / DENOMINATION).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

// Load the deployer wallet from env, or mint one and persist it to .env.
function loadDeployer() {
  const fromEnv = (process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (fromEnv) return { wallet: walletFromPrivate(fromEnv), generated: false };

  const wallet = createWallet();
  // Persist so re-runs reuse the same address (and the user can fund it once).
  let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  if (/^DEPLOYER_PRIVATE_KEY=/m.test(env)) {
    env = env.replace(/^DEPLOYER_PRIVATE_KEY=.*$/m, `DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`);
  } else {
    env += `${env.endsWith('\n') || env === '' ? '' : '\n'}\n# Deployer wallet (auto-generated). Fund this address with SAYN to pay deploy gas.\nDEPLOYER_PRIVATE_KEY=${wallet.privateKey}\n`;
  }
  fs.writeFileSync(ENV_PATH, env);
  return { wallet, generated: true };
}

// --------------------------------- main --------------------------------------
async function main() {
  const wait = process.argv.includes('--wait');
  console.log('\n  SAYMAN contract deploy');
  console.log(`  RPC  → ${RPC}\n`);

  // Refuse to deploy against a frozen chain — nothing would ever confirm.
  const live = await waitForLiveChain(wait);
  if (!live) {
    console.log('  ────────────────────────────────────────────────────────────');
    console.log('  The SAYMAN testnet is NOT producing blocks right now (frozen).');
    console.log('  Faucet drips and deploys are accepted but can never confirm');
    console.log('  until the node operator restarts block production. This is on');
    console.log('  their side — nothing is wrong with your wallet or this project.');
    console.log('');
    console.log('  → Re-run later, or leave it waiting to auto-deploy on recovery:');
    console.log('        npm run deploy -- --wait');
    console.log('  ────────────────────────────────────────────────────────────\n');
    process.exitCode = 1;
    return;
  }

  const { wallet, generated } = loadDeployer();
  console.log(`  Deployer address : ${wallet.address}`);
  if (generated) {
    console.log('  (no DEPLOYER_PRIVATE_KEY was set — generated one and saved it to .env)');
  }

  // Best-effort funding: check balance, hit the faucet if empty, wait a bit.
  let balance = await getBalance(wallet.address);
  console.log(`  Balance          : ${fmtSayn(balance)} SAYN\n`);

  if (balance <= 0) {
    console.log('  Balance is 0 — requesting a testnet faucet drip…');
    try {
      await requestFaucet(wallet.address);
      const start = Date.now();
      while (Date.now() - start < 45_000) {
        await sleep(3000);
        balance = await getBalance(wallet.address);
        if (balance > 0) break;
        process.stdout.write('.');
      }
      console.log('');
    } catch (e) {
      console.log(`  Faucet request failed: ${e.message}`);
    }
    console.log(`  Balance          : ${fmtSayn(balance)} SAYN\n`);
    if (balance <= 0) {
      console.log('  Still unfunded. Deploys use feePolicy="sponsor" so this may still');
      console.log(`  succeed; if the chain rejects it, send some SAYN to ${wallet.address}`);
      console.log('  and run `npm run deploy` again.\n');
    }
  }

  const { nonce: startNonce } = await getAccount(wallet.address);
  let nonce = startNonce;

  const results = [];
  for (const c of CONTRACTS) {
    const codePath = path.join(CONTRACTS_DIR, c.file);
    const code = fs.readFileSync(codePath, 'utf8');
    console.log(`  → Deploying ${c.name} (${code.length} bytes, nonce ${nonce})…`);

    const before = new Set((await listContracts().catch(() => [])).map((x) => x.address));

    const signed = signTx({
      wallet,
      type: 'CONTRACT_DEPLOY',
      data: {
        from: wallet.address,
        name: c.name,
        version: '1.0.0',
        abi: null,
        feePolicy: 'sponsor',
        code,
      },
      timestamp: Date.now(),
      gasLimit: deployGasLimit(code),
      gasPrice: 1,
      nonce,
    });

    try {
      const { txId } = await broadcast(signed);
      console.log(`     broadcast ok — txId ${txId || '(none returned)'}; resolving address…`);
      const onchain = await pollForContractByName(c.name, before);
      if (onchain?.address) {
        console.log(`     ✔ ${c.name} @ ${onchain.address}`);
        console.log(`       ${API}/contracts/${onchain.address}`);
        results.push({ name: c.name, address: onchain.address, txId: txId ?? null, status: 'deployed' });
      } else {
        console.log(`     … ${c.name} accepted but address not resolved within timeout (may land shortly)`);
        results.push({ name: c.name, address: null, txId: txId ?? null, status: 'pending' });
      }
    } catch (e) {
      console.log(`     ✖ ${c.name} failed: ${e.message}`);
      results.push({ name: c.name, address: null, txId: null, status: 'failed', error: e.message });
    }
    nonce += 1;
    console.log('');
  }

  // Persist a deployment record.
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const record = {
    network: 'sayman-testnet',
    rpc: RPC,
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    contracts: results,
  };
  const outFile = path.join(OUT_DIR, 'sayman.json');
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n');

  const ok = results.filter((r) => r.status === 'deployed').length;
  console.log(`  Done. ${ok}/${CONTRACTS.length} contract(s) confirmed on-chain.`);
  console.log(`  Record written to ${path.relative(ROOT, outFile)}\n`);

  if (ok === 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n  Deploy crashed:', e.message, '\n');
  process.exitCode = 1;
});
