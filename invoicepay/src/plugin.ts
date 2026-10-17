import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { proposeSolana, solanaOutputSchema } from "./paybox.js";
import { buildUsdcPaymentTx, verifyUsdcPayment } from "./usdc.js";

const PROTOCOL_VERSION = "2026-07-28";
const address = z.string().min(32).max(44);

function createServer() {
  const server = new McpServer(
    { name: "usdc-invoice-pay", version: "0.1.0" },
    { supportedProtocolVersions: [PROTOCOL_VERSION] },
  );

  server.registerTool(
    "propose_usdc_payment",
    {
      title: "Propose USDC invoice payment",
      description:
        "Prepare an unsigned Solana USDC payment to a merchant for an invoice. Creates the merchant's USDC account if needed. The user reviews and approves in PayBox; nothing is signed or sent by this tool.",
      inputSchema: z
        .object({
          sender: address.describe("Public Solana address of the paying wallet."),
          recipient: address.describe("Public Solana address of the merchant receiving USDC."),
          amountUsdc: z.string().min(1).max(32).describe('Invoice amount in USDC as a decimal string, e.g. "12.50".'),
          memo: z.string().max(100).optional().describe("Optional invoice reference recorded on-chain, e.g. INV-1042."),
        })
        .strict(),
      outputSchema: solanaOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => proposeSolana({ transactionBase64: buildUsdcPaymentTx(args) }),
  );

  const verifyOutput = z
    .object({
      status: z.enum(["confirmed_paid", "confirmed_underpaid", "not_found", "failed_on_chain", "no_usdc_to_recipient"]),
      verified: z.boolean(),
      receivedUsdc: z.string(),
      expectedUsdc: z.string(),
      signature: z.string(),
    })
    .strict();

  server.registerTool(
    "verify_usdc_payment",
    {
      title: "Verify USDC invoice payment",
      description:
        "Check on Solana mainnet whether a transaction paid at least the invoice amount in USDC to the merchant. Read-only.",
      inputSchema: z
        .object({
          signature: z.string().min(64).max(90).describe("Solana transaction signature of the payment."),
          recipient: address.describe("Public Solana address of the merchant who should have received USDC."),
          minAmountUsdc: z.string().min(1).max(32).describe('Invoice amount in USDC as a decimal string, e.g. "12.50".'),
        })
        .strict(),
      outputSchema: verifyOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const r = await verifyUsdcPayment(args);
      return {
        content: [{ type: "text" as const, text: r.verified ? `Paid: ${r.receivedUsdc} USDC received.` : `Not verified (${r.status}); received ${r.receivedUsdc} of ${r.expectedUsdc} USDC.` }],
        structuredContent: r,
      };
    },
  );

  return server;
}

serveStdio(createServer, { legacy: "reject" });
