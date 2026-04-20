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
  evmListener: EvmListener
) {
  return async (event: BridgeEvent): Promise<void> => {
    const relay = async () => {
      try {
        if (event.direction === BridgeDirection.EVM_TO_SOLANA) {
          // EVM Locked → Solana mint_wrapped  (not yet implemented — handled by SolanaBroadcaster directly)
          // For the EVM→Solana path the SolanaBroadcaster.submitMintWrapped would be called here.
          // Placeholder: log and skip (Solana TX submission requires full IDL + accounts).
          logger.info(`[Relay] EVM→SOL: LOCK event routed to Solana broadcaster | nonce: ${event.bridgeNonce}`);

        } else if (event.direction === BridgeDirection.SOLANA_TO_EVM) {
          if (event.eventType === "LOCK") {
            // Solana LOCK → EVM mintWrapped
            const sig = await signer.signMint({
              originChainId:  config.solanaChainId,
              foreignAssetId: event.assetId.startsWith("0x")
                ? event.assetId
                : "0x" + Buffer.from(event.assetId).toString("hex").padStart(64, "0"),
              recipient:     event.recipient,
              amount:        event.amount,
              bridgeNonce:   event.bridgeNonce,
            });

            await evmListener.submitMintWrapped({
              originChainId:  config.solanaChainId,
              foreignAssetId: event.assetId.startsWith("0x")
                ? event.assetId
                : "0x" + Buffer.from(event.assetId).toString("hex").padStart(64, "0"),
              recipient:     event.recipient,
              amount:        event.amount,
              bridgeNonce:   event.bridgeNonce,
              sig,
            });

          } else if (event.eventType === "BURN") {
            // Solana BURN → EVM unlockNative
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

  // Bootstrap EVM listener first so we can pass it to dispatcher
  const evmListener = new EvmListener(config, async (_) => {});
  const dispatcher  = await createDispatcher(config, signer, evmListener);

  // Wire callbacks
  const evmListenerWithCb = new EvmListener(config, dispatcher);
  const solanaBroadcaster = new SolanaBroadcaster(config, dispatcher);

  await evmListenerWithCb.start();
  solanaBroadcaster.start();

  // Graceful shutdown
  process.on("SIGINT",  () => shutdown(evmListenerWithCb, solanaBroadcaster));
  process.on("SIGTERM", () => shutdown(evmListenerWithCb, solanaBroadcaster));

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

main().catch((e) => {
  logger.error("Fatal relayer error:", e);
  process.exit(1);
});
