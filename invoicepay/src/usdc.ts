import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { atomicAmount } from "./paybox.js";

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";
const RPC_URL = "https://api.mainnet-beta.solana.com";

function pubkey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana address.`);
  }
}

function positiveUsdc(amount: string): string {
  const atomic = atomicAmount(amount, 6);
  if (BigInt(atomic) <= 0n) throw new Error("Amount must be greater than zero.");
  if (BigInt(atomic) >= 2n ** 64n) throw new Error("Amount is too large.");
  return atomic;
}

/** Builds an unsigned USDC payment: create the recipient's USDC account if missing, then transfer. */
export function buildUsdcPaymentTx(input: { sender: string; recipient: string; amountUsdc: string; memo?: string }): string {
  const sender = pubkey(input.sender, "sender");
  const recipient = pubkey(input.recipient, "recipient");
  if (sender.equals(recipient)) throw new Error("Sender and recipient must be different.");
  const atomic = positiveUsdc(input.amountUsdc);
  const mint = new PublicKey(USDC_MINT);
  const fromAta = getAssociatedTokenAddressSync(mint, sender, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, recipient, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const tx = new Transaction({ feePayer: sender, recentBlockhash: PLACEHOLDER_BLOCKHASH });
  tx.add(createAssociatedTokenAccountIdempotentInstruction(sender, toAta, recipient, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, sender, BigInt(atomic), 6, [], TOKEN_PROGRAM_ID));
  if (input.memo) {
    tx.add(new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(input.memo, "utf8") }));
  }
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
}

export type VerifyResult = {
  status: "confirmed_paid" | "confirmed_underpaid" | "not_found" | "failed_on_chain" | "no_usdc_to_recipient";
  verified: boolean;
  receivedUsdc: string;
  expectedUsdc: string;
  signature: string;
};

function formatUsdc(atomic: bigint): string {
  const s = atomic.toString().padStart(7, "0");
  const whole = s.slice(0, -6);
  const frac = s.slice(-6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

type TokenBalance = { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } };

/** Checks a confirmed Solana transaction and measures how much USDC the recipient gained. */
export async function verifyUsdcPayment(
  input: { signature: string; recipient: string; minAmountUsdc: string },
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const recipient = pubkey(input.recipient, "recipient").toBase58();
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(input.signature)) throw new Error("signature is not a valid Solana transaction signature.");
  const expected = BigInt(positiveUsdc(input.minAmountUsdc));
  const base = { expectedUsdc: formatUsdc(expected), signature: input.signature };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  let json: any;
  try {
    const res = await fetchImpl(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getTransaction",
        params: [input.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }],
      }),
    });
    if (!res.ok) throw new Error(`Solana RPC returned HTTP ${res.status}.`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (json?.error) throw new Error(`Solana RPC error: ${String(json.error.message ?? "unknown").slice(0, 120)}`);
  const tx = json?.result;
  if (!tx) return { ...base, status: "not_found", verified: false, receivedUsdc: "0" };
  if (tx.meta?.err) return { ...base, status: "failed_on_chain", verified: false, receivedUsdc: "0" };

  const sum = (list: TokenBalance[] | undefined) =>
    (list ?? [])
      .filter((b) => b.owner === recipient && b.mint === USDC_MINT)
      .reduce((acc, b) => acc + BigInt(b.uiTokenAmount?.amount ?? "0"), 0n);
  const delta = sum(tx.meta?.postTokenBalances) - sum(tx.meta?.preTokenBalances);
  if (delta <= 0n) return { ...base, status: "no_usdc_to_recipient", verified: false, receivedUsdc: "0" };
  const received = formatUsdc(delta);
  return delta >= expected
    ? { ...base, status: "confirmed_paid", verified: true, receivedUsdc: received }
    : { ...base, status: "confirmed_underpaid", verified: false, receivedUsdc: received };
}
