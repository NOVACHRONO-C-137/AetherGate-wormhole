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
  SystemProgram,
  BN,
} from "@solana/web3.js";
import { AnchorProvider, Program, Idl, AnchorWallet } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import { BridgeDirection, BridgeEvent, RelayerConfig } from "./types.js";
import { logger } from "./logger.js";

// Full Anchor IDL for the AetherGate Solana program
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
    {
      name: "WrappedMinted",
      fields: [
        { name: "bridge_nonce",  type: { array: ["u8", 32] } },
        { name: "recipient",     type: "publicKey" },
        { name: "wrapped_mint",  type: "publicKey" },
        { name: "amount",        type: "u64" },
        { name: "origin_chain_id", type: "u64" },
      ],
    },
    {
      name: "Unlocked",
      fields: [
        { name: "bridge_nonce",   type: { array: ["u8", 32] } },
        { name: "recipient",      type: "publicKey" },
        { name: "mint",           type: "publicKey" },
        { name: "amount",         type: "u64" },
        { name: "origin_chain_id",type: "u64" },
      ],
    },
  ],
  instructions: [
    {
      name: "mint_wrapped",
      accounts: [
        { name: "relayer",            isMut: true,  isSigner: true  },
        { name: "recipient",          isMut: false, isSigner: false },
        { name: "bridge_state",       isMut: false, isSigner: false },
        { name: "wrapped_mint",       isMut: true,  isSigner: false },
        { name: "mint_authority",     isMut: false, isSigner: false },
        { name: "recipient_token_account", isMut: true,  isSigner: false },
        { name: "nonce_account",      isMut: true,  isSigner: false },
        { name: "token_program",      isMut: false, isSigner: false },
        { name: "system_program",     isMut: false, isSigner: false },
      ],
      args: [
        { name: "amount",          type: "u64"  },
        { name: "bridge_nonce",    type: { array: ["u8", 32] } },
        { name: "origin_chain_id", type: "u64"  },
      ],
    },
    {
      name: "unlock_native",
      accounts: [
        { name: "relayer",            isMut: true,  isSigner: true  },
        { name: "recipient",          isMut: false, isSigner: false },
        { name: "bridge_state",       isMut: false, isSigner: false },
        { name: "mint",               isMut: false, isSigner: false },
        { name: "vault_authority",    isMut: false, isSigner: false },
        { name: "vault_token_account",isMut: true,  isSigner: false },
        { name: "recipient_token_account", isMut: true,  isSigner: false },
        { name: "nonce_account",      isMut: true,  isSigner: false },
        { name: "token_program",      isMut: false, isSigner: false },
        { name: "system_program",     isMut: false, isSigner: false },
        { name: "associated_token_program", isMut: false, isSigner: false },
      ],
      args: [
        { name: "amount",          type: "u64"  },
        { name: "bridge_nonce",    type: { array: ["u8", 32] } },
        { name: "origin_chain_id", type: "u64"  },
      ],
    },
  ],
  accounts: [],
} as unknown as Idl;

const BRIDGE_SEED = "bridge";
const VAULT_SEED = "vault";
const MINT_AUTH_SEED = "mint_auth";
const NONCE_SEED = "nonce";

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

  // ─── Write methods ────────────────────────────────────────────────────────

  async submitMintWrapped(params: {
    wrappedMint:    PublicKey | string;
    recipient:      PublicKey | string;
    amount:         bigint;
    bridgeNonce:    number[];
    originChainId:  number;
  }): Promise<string> {
    const programId = new PublicKey(this.config.solanaProgramId);

    const normalize = (p: PublicKey | string): PublicKey => {
      if (typeof p === "string") {
        if (p.startsWith("0x")) {
          const hex = p.slice(2);
          return new PublicKey(Buffer.from(hex, "hex"));
        } else {
          return new PublicKey(p);
        }
      }
      return p;
    };

    const recipient = normalize(params.recipient);
    const mint = normalize(params.wrappedMint);

    const [bridgeState] = PublicKey.findProgramAddressSync(
      [Buffer.from(BRIDGE_SEED)],
      programId
    );

    const [mintAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from(MINT_AUTH_SEED), mint.toBuffer()],
      programId
    );

    const nonceBytes = Buffer.from(params.bridgeNonce);
    if (nonceBytes.length !== 32) {
      throw new Error(`Invalid bridgeNonce length: expected 32 bytes, got ${nonceBytes.length}`);
    }
    const [nonceAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from(NONCE_SEED), nonceBytes],
      programId
    );

    const [recipientTokenAccount] = PublicKey.findProgramAddressSync(
      [recipient.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    try {
      const signature = await this.program.methods
        .mint_wrapped(
          new BN(params.amount.toString()),
          Array.from(nonceBytes),
          params.originChainId
        )
        .accounts({
          relayer: this.relayerKeypair.publicKey,
          recipient,
          bridge_state: bridgeState,
          wrapped_mint: mint,
          mint_authority: mintAuthority,
          recipient_token_account: recipientTokenAccount,
          nonce_account: nonceAccount,
          token_program: TOKEN_PROGRAM_ID,
          system_program: SystemProgram.programId,
        })
        .rpc();

      logger.info(`[Solana] mintWrapped tx: ${signature}`);
      return signature;
    } catch (error) {
      logger.error("[Solana] mintWrapped error:", error);
      throw error;
    }
  }

  async submitUnlockNative(params: {
    mint:           PublicKey | string;
    recipient:      PublicKey | string;
    amount:         bigint;
    bridgeNonce:    number[];
    originChainId:  number;
  }): Promise<string> {
    const programId = new PublicKey(this.config.solanaProgramId);

    const normalize = (p: PublicKey | string): PublicKey => {
      if (typeof p === "string") {
        if (p.startsWith("0x")) {
          const hex = p.slice(2);
          return new PublicKey(Buffer.from(hex, "hex"));
        } else {
          return new PublicKey(p);
        }
      }
      return p;
    };

    const mint = normalize(params.mint);
    const recipient = normalize(params.recipient);

    const [bridgeState] = PublicKey.findProgramAddressSync(
      [Buffer.from(BRIDGE_SEED)],
      programId
    );

    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from(VAULT_SEED), mint.toBuffer()],
      programId
    );

    const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [vaultAuthority.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [recipientTokenAccount] = PublicKey.findProgramAddressSync(
      [recipient.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const nonceBytes = Buffer.from(params.bridgeNonce);
    if (nonceBytes.length !== 32) {
      throw new Error(`Invalid bridgeNonce length: expected 32 bytes, got ${nonceBytes.length}`);
    }
    const [nonceAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from(NONCE_SEED), nonceBytes],
      programId
    );

    try {
      const signature = await this.program.methods
        .unlock_native(
          new BN(params.amount.toString()),
          Array.from(nonceBytes),
          params.originChainId
        )
        .accounts({
          relayer: this.relayerKeypair.publicKey,
          recipient,
          bridge_state: bridgeState,
          mint,
          vault_authority: vaultAuthority,
          vault_token_account: vaultTokenAccount,
          recipient_token_account: recipientTokenAccount,
          nonce_account: nonceAccount,
          token_program: TOKEN_PROGRAM_ID,
          system_program: SystemProgram.programId,
          associated_token_program: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();

      logger.info(`[Solana] unlockNative tx: ${signature}`);
      return signature;
    } catch (error) {
      logger.error("[Solana] unlockNative error:", error);
      throw error;
    }
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

// ─── Utilities ───────────────────────────────────────────────────────────────

function bufToHex(buf: number[]): string {
  return "0x" + Buffer.from(buf).toString("hex");
}