import * as z from "zod/v4";

const key = "io.paybox/transactionProposal";
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const atomic = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const common = { version: z.literal("1"), expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/) };
const evm = z.object({
  ...common, kind: z.literal("evm"), chain: z.string().regex(/^eip155:(0|[1-9][0-9]*)$/),
  transaction: z.object({ to: evmAddress, value: atomic, data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/) }).strict(),
}).strict();
const solana = z.object({
  ...common, kind: z.literal("solana"), chain: z.literal("solana:mainnet"),
  transaction: z.object({ transactionBase64: z.string() }).strict(),
}).strict();
const x402 = z.object({
  ...common, kind: z.literal("x402"), chain: z.enum(["eip155:8453", "solana:mainnet"]),
  request: z.object({ url: z.url().max(2048), method: z.enum(["GET", "POST"]), body: z.json().optional() }).strict(),
  payment: z.object({ asset: z.string(), maxAmount: z.string().regex(/^[1-9][0-9]{0,19}$/) }).strict(),
}).strict();

export const evmOutputSchema = z.object({ [key]: evm }).strict();
export const solanaOutputSchema = z.object({ [key]: solana }).strict();
export const x402OutputSchema = z.object({ [key]: x402 }).strict();

function result<T>(proposal: T) {
  return {
    content: [{ type: "text" as const, text: "Unsigned proposal prepared. PayBox must validate and obtain any required approval; nothing has been signed or paid." }],
    structuredContent: { [key]: proposal },
  };
}

function envelope(expiresAt = new Date(Date.now() + 240_000).toISOString().replace(/\.\d{3}Z$/, "Z")) {
  const timestamp = Date.parse(expiresAt);
  const now = Date.now();
  if (!Number.isFinite(timestamp) || timestamp <= now || timestamp > now + 300_000 || new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z") !== expiresAt) {
    throw new Error("Expiry must be a whole-second UTC timestamp within five minutes.");
  }
  return { version: "1" as const, expiresAt };
}

export function proposeSolana(input: { transactionBase64: string; expiresAt?: string }) {
  const bytes = Buffer.from(input.transactionBase64, "base64");
  if (!bytes.length || bytes.length > 1232 || bytes.toString("base64") !== input.transactionBase64) {
    throw new Error("Use canonical padded Base64 for an unsigned Solana transaction of at most 1,232 bytes.");
  }
  return result(solana.parse({ ...envelope(input.expiresAt), kind: "solana", chain: "solana:mainnet",
    transaction: { transactionBase64: input.transactionBase64 },
  }));
}

export function atomicAmount(amount: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255 || amount.length > 256 || !/^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount)) {
    throw new Error("Use a nonnegative decimal string and an integer token precision from 0 to 255.");
  }
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) throw new Error("Amount has more decimal places than the asset supports.");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`).toString();
}
