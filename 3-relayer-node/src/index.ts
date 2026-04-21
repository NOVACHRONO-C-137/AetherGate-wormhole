/**
 * AetherGate Relayer — Main Orchestrator
 *
 * Boots the EVM listener and Solana broadcaster, wires their event
 * callbacks into the relay dispatch logic, and handles retry/error cases.
 */

import "dotenv/config";
import { RelayerConfig, BridgeEvent, BridgeDirection } from "./types.js";
import { SigningModule } from "./signer.js";
import { EvmListener } from "./evmListener.js";
import { SolanaBroadcaster } from "./solanaBroadcaster.js";
import { logger } from "./logger.js";
import bs58 from "bs58";

// ─── Load & validate config ──────────────────────────────────────────────────

function loadConfig(): RelayerConfig {
  const required = [
    "EVM_RPC_URL",
    "EVM_VAULT_BRIDGE_ADDRESS",
    "RELAYER_EVM_PRIVATE_KEY",
    "SOLANA_RPC_URL",
    "SOLANA_CHAIN_ID",
    "RELAYER_SOLANA_PRIVATE_KEY",
    "SOLANA_PROGRAM_ID",
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }

  return {
    evmRpcUrl:             process.env.EVM_RPC_URL!,
    evmVaultBridgeAddress: process.env.EVM_VAULT_BRIDGE_ADDRESS!,
    relayerEvmPrivateKey:  process.env.RELAYER_EVM_PRIVATE_KEY!,
    solanaRpcUrl:          process.env.SOLANA_RPC_URL!,
    solanaChainId:         parseInt(process.env.SOLANA_CHAIN_ID!, 10), // 101 = Devnet
    relayerSolanaKey:      process.env.RELAYER_SOLANA_PRIVATE_KEY!,
    solanaProgramId:       process.env.SOLANA_PROGRAM_ID!,
    solanaPollIntervalMs:  parseInt(process.env.SOLANA_POLL_INTERVAL_MS ?? "4000", 10),
    evmConfirmations:      parseInt(process.env.EVM_CONFIRMATIONS ?? "2", 10),
    maxRetries:            parseInt(process.env.MAX_RETRIES ?? "5", 10),
  };
}

// ─── Retry queue ─────────────────────────────────────────────────────────────

const retryQueue: BridgeEvent[] = [];

async function scheduleRetry(event: BridgeEvent, relayFn: () => Promise<void>): Promise<void> {
  if (event.retriesLeft <= 0) {
    logger.error(`[Relay] DEAD LETTER — nonce ${event.bridgeNonce} exhausted retries. Manual review required.`);
    return;
  }
  const delay = 5000 * (6 - event.retriesLeft); // backoff
  event.retriesLeft--;
  logger.warn(`[Relay] Retrying nonce ${event.bridgeNonce} in ${delay}ms (${event.retriesLeft} left)`);
  await sleep(delay);
  await relayFn();
}

// ─── Relay dispatcher ────────────────────────────────────────────────────────

async function createDispatcher(
  config: RelayerConfig,
  signer: SigningModule,
  evmListener: EvmListener,
  solanaBroadcaster: SolanaBroadcaster
) {
  return async (event: BridgeEvent): Promise<void> => {
    const relay = async () => {
      try {
        if (event.direction === BridgeDirection.EVM_TO_SOLANA) {
          if (event.eventType === "LOCK") {
            // EVM Lock → Solana mint_wrapped
            const evmToken = event.assetId.startsWith("0x")
              ? event.assetId.slice(2).toLowerCase()
              : event.assetId.toLowerCase();
            const wrappedMint = config.evmToSolWrappedMint?.[evmToken];
            if (!wrappedMint) {
              throw new Error(`Missing evmToSolWrappedMint mapping for token ${event.assetId}`);
            }
            const nonceBytes = hexToBytes(event.bridgeNonce);
            await solanaBroadcaster.submitMintWrapped({
              wrappedMint: wrappedMint,
              recipient: event.recipient,
              amount: event.amount,
              bridgeNonce: nonceBytes,
              originChainId: event.srcChainId,
            });

          } else if (event.eventType === "BURN") {
            // EVM Burn → Solana unlock_native
            const wrappedToken = event.assetId.startsWith("0x")
              ? event.assetId.slice(2).toLowerCase()
              : event.assetId.toLowerCase();
            const nativeMint = config.evmWrappedToSolNative?.[wrappedToken];
            if (!nativeMint) {
              throw new Error(`Missing evmWrappedToSolNative mapping for wrapped token ${event.assetId}`);
            }
            const nonceBytes = hexToBytes(event.bridgeNonce);
            await solanaBroadcaster.submitUnlockNative({
              mint: nativeMint,
              recipient: event.recipient,
              amount: event.amount,
              bridgeNonce: nonceBytes,
              originChainId: event.srcChainId,
            });
          }

        } else if (event.direction === BridgeDirection.SOLANA_TO_EVM) {
          if (event.eventType === "LOCK") {
            // Solana Lock → EVM mintWrapped
            const foreignAssetId = event.assetId.startsWith("0x")
              ? event.assetId
              : "0x" + Buffer.from(bs58.decode(event.assetId)).toString("hex").padStart(64, "0");

            const sig = await signer.signMint({
              originChainId:  config.solanaChainId,
              foreignAssetId,
              recipient:     event.recipient,
              amount:        event.amount,
              bridgeNonce:   event.bridgeNonce,
            });

            await evmListener.submitMintWrapped({
              originChainId:  config.solanaChainId,
              foreignAssetId,
              recipient:     event.recipient,
              amount:        event.amount,
              bridgeNonce:   event.bridgeNonce,
              sig,
            });

          } else if (event.eventType === "BURN") {
            // Solana Burn → EVM unlockNative
            const sig = await signer.signUnlock({
              token:         event.assetId,
              recipient:     event.recipient,
              amount:        event.amount,
              bridgeNonce:   event.bridgeNonce,
              originChainId: config.solanaChainId,
            });

            await evmListener.submitUnlockNative({
              token:         event.assetId,
              recipient:     event.recipient,
              amount:        event.amount,
              bridgeNonce:   event.bridgeNonce,
              originChainId: config.solanaChainId,
              sig,
            });
          }
        }
      } catch (err) {
        logger.error(`[Relay] Error processing nonce ${event.bridgeNonce}:`, err);
        await scheduleRetry(event, relay);
      }
    };

    await relay();
   };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("═══════════════════════════════════════");
  logger.info("   AetherGate Relayer v1.0 starting    ");
  logger.info("═══════════════════════════════════════");

  const config = loadConfig();
  const signer = new SigningModule(config.relayerEvmPrivateKey, 11155111); // Sepolia

  // Create listeners with a temporary no-op callback; we'll set the real dispatcher after creation
  let dispatcher: (event: BridgeEvent) => Promise<void>;

  const evmListener = new EvmListener(config, async (event) => {
    await dispatcher(event);
  });

  const solanaBroadcaster = new SolanaBroadcaster(config, async (event) => {
    await dispatcher(event);
  });

  // Create the dispatcher with the real listener instances
  dispatcher = await createDispatcher(config, signer, evmListener, solanaBroadcaster);

  await evmListener.start();
  solanaBroadcaster.start();

  // Graceful shutdown
  process.on("SIGINT",  () => shutdown(evmListener, solanaBroadcaster));
  process.on("SIGTERM", () => shutdown(evmListener, solanaBroadcaster));

  logger.info("[Main] Relayer running. Listening for cross-chain events...");
}

function shutdown(evm: EvmListener, sol: SolanaBroadcaster): void {
  logger.info("[Main] Shutting down gracefully...");
  evm.stop();
  sol.stop();
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hexToBytes(hex: string): number[] {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = [];
  for (let i = 0; i < h.length; i += 2) {
    bytes.push(parseInt(h.substr(i, 2), 16));
  }
  return bytes;
}

main().catch((e) => {
  logger.error("Fatal relayer error:", e);
  process.exit(1);
});
