/**
 * AetherGate Relayer — Solana Broadcaster (Solana Web3.js + Anchor)
 *
 * Polls for Anchor program logs (Locked / Burned events) on Solana.
 * Dispatches unlock or mintWrapped transactions back to EVM via the EvmListener.
 *
 * NOTE: Solana Devnet uses Chain ID 101 in AetherGate's internal scheme.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { AnchorProvider, Program, Idl, BN } from "@coral-xyz/anchor";
import { Wallet as AnchorWallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { BridgeDirection, BridgeEvent, RelayerConfig } from "./types.js";
import { logger } from "./logger.js";

// Minimal subset of the Anchor IDL for event parsing
const AETHER_GATE_IDL = {
  version: "0.1.0",
  name:    "aether_gate",
  events: [
    {
      name: "Locked",
      fields: [
        { name: "sender",        type: "publicKey" },
        { name: "mint",          type: "publicKey" },
        { name: "amount",        type: "u64" },
        { name: "fee",           type: "u64" },
        { name: "dest_chain_id", type: "u64" },
        { name: "dest_recipient",type: { array: ["u8", 32] } },
        { name: "bridge_nonce",  type: { array: ["u8", 32] } },
      ],
    },
    {
      name: "Burned",
      fields: [
        { name: "sender",         type: "publicKey" },
        { name: "wrapped_mint",   type: "publicKey" },
        { name: "amount",         type: "u64" },
        { name: "fee",            type: "u64" },
        { name: "dest_chain_id",  type: "u64" },
        { name: "dest_recipient", type: { array: ["u8", 32] } },
        { name: "bridge_nonce",   type: { array: ["u8", 32] } },
      ],
    },
  ],
  instructions: [],
  accounts: [],
} as unknown as Idl;

export class SolanaBroadcaster {
  private connection: Connection;
  private relayerKeypair: Keypair;
  private program: Program;
  private lastSignature: string | undefined;
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: RelayerConfig,
    private readonly onEvent: (event: BridgeEvent) => Promise<void>
  ) {
    this.connection     = new Connection(config.solanaRpcUrl, "confirmed");
    this.relayerKeypair = Keypair.fromSecretKey(
      bs58.decode(config.relayerSolanaKey)
    );

    const wallet   = new AnchorWallet(this.relayerKeypair);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });

    this.program = new Program(
      AETHER_GATE_IDL,
      new PublicKey(config.solanaProgramId),
      provider
    );

    logger.info(`[Solana] Broadcaster ready. Program: ${config.solanaProgramId}`);
    logger.info(`[Solana] Chain ID 101 = Solana Devnet in AetherGate routing`);
  }

  start(): void {
    logger.info(`[Solana] Polling every ${this.config.solanaPollIntervalMs}ms`);
    this.pollTimer = setInterval(
      () => this._poll().catch((e) => logger.error("[Solana] Poll error:", e)),
      this.config.solanaPollIntervalMs
    );
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    logger.info("[Solana] Broadcaster stopped.");
  }

  // ─── Polling ──────────────────────────────────────────────────────────────

  private async _poll(): Promise<void> {
    const programId = new PublicKey(this.config.solanaProgramId);

    const sigs = await this.connection.getSignaturesForAddress(programId, {
      limit: 20,
      until: this.lastSignature,
    });

    if (sigs.length === 0) return;
    this.lastSignature = sigs[0].signature;

    // Process oldest-first
    for (const sigInfo of sigs.reverse()) {
      if (sigInfo.err) continue;
      await this._processTransaction(sigInfo.signature);
    }
  }

  private async _processTransaction(signature: string): Promise<void> {
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx?.meta?.logMessages) return;

    const events = this._parseEvents(tx.meta.logMessages);
    for (const { name, data } of events) {
      await this._handleParsedEvent(name, data, signature, tx.slot);
    }
  }

  // ─── Event parsing via log discriminators ─────────────────────────────────

  private _parseEvents(
    logs: string[]
  ): Array<{ name: string; data: Record<string, unknown> }> {
    const results: Array<{ name: string; data: Record<string, unknown> }> = [];
    const eventPrefix = "Program data: ";

    for (const log of logs) {
      if (!log.startsWith(eventPrefix)) continue;
      try {
        const b64  = log.slice(eventPrefix.length);
        const buf  = Buffer.from(b64, "base64");
        // Anchor event coder parses discriminator + borsh data
        const decoded = (this.program as any).coder.events.decode(buf.toString("base64"));
        if (decoded) {
          results.push({ name: decoded.name, data: decoded.data });
        }
      } catch {
        // Not an AetherGate event
      }
    }
    return results;
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  private async _handleParsedEvent(
    name: string,
    data: Record<string, unknown>,
    txHash: string,
    slot: number
  ): Promise<void> {
    if (name === "Locked") {
      logger.info(`[Solana] Locked event | nonce: ${bufToHex(data.bridge_nonce as number[])}`);
      const event: BridgeEvent = {
        direction:   BridgeDirection.SOLANA_TO_EVM,
        bridgeNonce: bufToHex(data.bridge_nonce as number[]),
        sender:      (data.sender as PublicKey).toBase58(),
        recipient:   bufToHex(data.dest_recipient as number[]),
        assetId:     (data.mint as PublicKey).toBase58(),
        amount:      BigInt((data.amount as BN).toString()),
        fee:         BigInt((data.fee as BN).toString()),
        srcChainId:  this.config.solanaChainId,
        destChainId: Number((data.dest_chain_id as BN).toString()),
        txHash,
        blockNumber: slot,
        retriesLeft: this.config.maxRetries,
        eventType:   "LOCK",
      };
      await this.onEvent(event);
    } else if (name === "Burned") {
      logger.info(`[Solana] Burned event | nonce: ${bufToHex(data.bridge_nonce as number[])}`);
      const event: BridgeEvent = {
        direction:   BridgeDirection.SOLANA_TO_EVM,
        bridgeNonce: bufToHex(data.bridge_nonce as number[]),
        sender:      (data.sender as PublicKey).toBase58(),
        recipient:   bufToHex(data.dest_recipient as number[]),
        assetId:     (data.wrapped_mint as PublicKey).toBase58(),
        amount:      BigInt((data.amount as BN).toString()),
        fee:         BigInt((data.fee as BN).toString()),
        srcChainId:  this.config.solanaChainId,
        destChainId: Number((data.dest_chain_id as BN).toString()),
        txHash,
        blockNumber: slot,
        retriesLeft: this.config.maxRetries,
        eventType:   "BURN",
      };
      await this.onEvent(event);
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function bufToHex(buf: number[]): string {
  return "0x" + Buffer.from(buf).toString("hex");
}
