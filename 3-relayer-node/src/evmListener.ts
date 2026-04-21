/**
 * AetherGate Relayer — EVM Listener (Ethers.js v6)
 *
 * Subscribes to VaultBridge events:
 *   • Locked  → relay to Solana (mintWrapped on EVM side = unlock on Solana)
 *   • Burned  → relay to EVM    (unlockNative)
 *
 * Uses a persistent WebSocket provider with auto-reconnect.
 */

import {
  ethers,
  Contract,
  WebSocketProvider,
  JsonRpcProvider,
  EventLog,
} from "ethers";
import { BridgeDirection, BridgeEvent, RelayerConfig } from "./types.js";
import { logger } from "./logger.js";

// Minimal ABI — only the events the relayer cares about
const VAULT_BRIDGE_ABI = [
  "event Locked(address indexed sender, address indexed token, uint256 amount, uint256 fee, uint256 destChainId, bytes32 destRecipient, bytes32 indexed bridgeNonce)",
  "event Burned(address indexed sender, address indexed wrappedToken, uint256 amount, uint256 fee, uint256 destChainId, bytes32 destRecipient, bytes32 indexed bridgeNonce)",
  // Write functions called by relayer
  "function unlockNative(address token, address recipient, uint256 amount, bytes32 bridgeNonce, uint256 originChainId, bytes calldata sig) external",
  "function mintWrapped(uint256 originChainId, bytes32 foreignAssetId, address recipient, uint256 amount, bytes32 bridgeNonce, bytes calldata sig) external",
];

export class EvmListener {
  private provider!: WebSocketProvider | JsonRpcProvider;
  private contract!: Contract;
  private relayerWallet!: ethers.Wallet;

  constructor(
    private readonly config: RelayerConfig,
    private readonly onEvent: (event: BridgeEvent) => Promise<void>
  ) {}

async start(): Promise<void> {
    this.provider = this.config.evmRpcUrl.startsWith("wss")
      ? new WebSocketProvider(this.config.evmRpcUrl)
      : new JsonRpcProvider(this.config.evmRpcUrl);

    this.relayerWallet = new ethers.Wallet(
      this.config.relayerEvmPrivateKey,
      this.provider
    );

    this.contract = new Contract(
      this.config.evmVaultBridgeAddress,
      VAULT_BRIDGE_ABI,
      this.relayerWallet
    );

    logger.info(`[EVM Listener] Watching ${this.config.evmVaultBridgeAddress} on ${this.config.evmRpcUrl}`);

    this._subscribeToLocked();
    this._subscribeToBurned();
  }

  // ─── Event: Locked ────────────────────────────────────────────────────────

  private _subscribeToLocked(): void {
    this.contract.on(
      "Locked",
      async (
        sender, token, amount, fee, destChainId, destRecipient, bridgeNonce,
        eventLog: EventLog
      ) => {
        logger.info(`[EVM] Locked event | nonce: ${bridgeNonce} | amount: ${amount}`);

        const blockNumber = eventLog.blockNumber;

        // Wait for required confirmations
        await this._waitForConfirmations(blockNumber);

        const event: BridgeEvent = {
          direction:   BridgeDirection.EVM_TO_SOLANA,
          bridgeNonce: bridgeNonce as string,
          sender:      sender as string,
          recipient:   bytes32ToHex(destRecipient as string), // EVM addr encoded in bytes32
          assetId:     token as string,
          amount:      BigInt(amount.toString()),
          fee:         BigInt(fee.toString()),
          srcChainId:  Number((await this.provider.getNetwork()).chainId),
          destChainId: Number(destChainId),
          txHash:      eventLog.transactionHash,
          blockNumber,
          retriesLeft: this.config.maxRetries,
          eventType:   "LOCK",
        };

        await this.onEvent(event);
      }
    );
  }

  // ─── Event: Burned ────────────────────────────────────────────────────────

  private _subscribeToBurned(): void {
    this.contract.on(
      "Burned",
      async (
        sender, wrappedToken, amount, fee, destChainId, destRecipient, bridgeNonce,
        eventLog: EventLog
      ) => {
        logger.info(`[EVM] Burned event | nonce: ${bridgeNonce} | amount: ${amount}`);

        const blockNumber = eventLog.blockNumber;
        await this._waitForConfirmations(blockNumber);

        const event: BridgeEvent = {
          direction:   BridgeDirection.EVM_TO_SOLANA,
          bridgeNonce: bridgeNonce as string,
          sender:      sender as string,
          recipient:   bytes32ToHex(destRecipient as string),
          assetId:     wrappedToken as string,
          amount:      BigInt(amount.toString()),
          fee:         BigInt(fee.toString()),
          srcChainId:  Number((await this.provider.getNetwork()).chainId),
          destChainId: Number(destChainId),
          txHash:      eventLog.transactionHash,
          blockNumber,
          retriesLeft: this.config.maxRetries,
          eventType:   "BURN",
        };

        await this.onEvent(event);
      }
    );
  }

  // ─── Write: submit relay transaction ─────────────────────────────────────

  async submitUnlockNative(params: {
    token:          string;
    recipient:      string;
    amount:         bigint;
    bridgeNonce:    string;
    originChainId:  number;
    sig:            string;
  }): Promise<ethers.TransactionReceipt | null> {
    logger.info(`[EVM] Submitting unlockNative | nonce: ${params.bridgeNonce}`);
    const tx = await (this.contract as any).unlockNative(
      params.token,
      params.recipient,
      params.amount,
      params.bridgeNonce,
      params.originChainId,
      params.sig
    );
    const receipt = await tx.wait(1);
    logger.info(`[EVM] unlockNative confirmed | tx: ${receipt?.hash}`);
    return receipt;
  }

  async submitMintWrapped(params: {
    originChainId:  number;
    foreignAssetId: string;
    recipient:      string;
    amount:         bigint;
    bridgeNonce:    string;
    sig:            string;
  }): Promise<ethers.TransactionReceipt | null> {
    logger.info(`[EVM] Submitting mintWrapped | nonce: ${params.bridgeNonce}`);
    const tx = await (this.contract as any).mintWrapped(
      params.originChainId,
      params.foreignAssetId,
      params.recipient,
      params.amount,
      params.bridgeNonce,
      params.sig
    );
    const receipt = await tx.wait(1);
    logger.info(`[EVM] mintWrapped confirmed | tx: ${receipt?.hash}`);
    return receipt;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async _waitForConfirmations(fromBlock: number): Promise<void> {
    const target = fromBlock + this.config.evmConfirmations;
    while (true) {
      const current = await this.provider.getBlockNumber();
      if (current >= target) break;
      await sleep(2000);
    }
  }

  stop(): void {
    this.contract.removeAllListeners();
    logger.info("[EVM Listener] Stopped.");
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function bytes32ToHex(b32: string): string {
  // Convert a Solidity bytes32 to full 32-byte hex (64 hex chars) with 0x prefix
  const hex = b32.startsWith("0x") ? b32.slice(2) : b32;
  return "0x" + hex.padStart(64, "0");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
