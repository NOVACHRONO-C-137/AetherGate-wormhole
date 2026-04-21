"use strict";
/**
 * AetherGate Relayer — EVM Listener (Ethers.js v6)
 *
 * Subscribes to VaultBridge events:
 *   • Locked  → relay to Solana (mintWrapped on EVM side = unlock on Solana)
 *   • Burned  → relay to EVM    (unlockNative)
 *
 * Uses a persistent WebSocket provider with auto-reconnect.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvmListener = void 0;
const ethers_1 = require("ethers");
const types_js_1 = require("./types.js");
const logger_js_1 = require("./logger.js");
// Minimal ABI — only the events the relayer cares about
const VAULT_BRIDGE_ABI = [
    "event Locked(address indexed sender, address indexed token, uint256 amount, uint256 fee, uint256 destChainId, bytes32 destRecipient, bytes32 indexed bridgeNonce)",
    "event Burned(address indexed sender, address indexed wrappedToken, uint256 amount, uint256 fee, uint256 destChainId, bytes32 destRecipient, bytes32 indexed bridgeNonce)",
    // Write functions called by relayer
    "function unlockNative(address token, address recipient, uint256 amount, bytes32 bridgeNonce, uint256 originChainId, bytes calldata sig) external",
    "function mintWrapped(uint256 originChainId, bytes32 foreignAssetId, address recipient, uint256 amount, bytes32 bridgeNonce, bytes calldata sig) external",
];
class EvmListener {
    config;
    onEvent;
    provider;
    contract;
    relayerWallet;
    constructor(config, onEvent) {
        this.config = config;
        this.onEvent = onEvent;
    }
    async start() {
        this.provider = this.config.evmRpcUrl.startsWith("wss")
            ? new ethers_1.WebSocketProvider(this.config.evmRpcUrl)
            : new ethers_1.JsonRpcProvider(this.config.evmRpcUrl);
        this.relayerWallet = new ethers_1.ethers.Wallet(this.config.relayerEvmPrivateKey, this.provider);
        this.contract = new ethers_1.Contract(this.config.evmVaultBridgeAddress, VAULT_BRIDGE_ABI, this.relayerWallet);
        logger_js_1.logger.info(`[EVM Listener] Watching ${this.config.evmVaultBridgeAddress} on ${this.config.evmRpcUrl}`);
        this._subscribeToLocked();
        this._subscribeToBurned();
    }
    // ─── Event: Locked ────────────────────────────────────────────────────────
    _subscribeToLocked() {
        this.contract.on("Locked", async (sender, token, amount, fee, destChainId, destRecipient, bridgeNonce, eventLog) => {
            logger_js_1.logger.info(`[EVM] Locked event | nonce: ${bridgeNonce} | amount: ${amount}`);
            const blockNumber = eventLog.blockNumber;
            // Wait for required confirmations
            await this._waitForConfirmations(blockNumber);
            const event = {
                direction: types_js_1.BridgeDirection.EVM_TO_SOLANA,
                bridgeNonce: bridgeNonce,
                sender: sender,
                recipient: bytes32ToHex(destRecipient), // EVM addr encoded in bytes32
                assetId: token,
                amount: BigInt(amount.toString()),
                fee: BigInt(fee.toString()),
                srcChainId: Number((await this.provider.getNetwork()).chainId),
                destChainId: Number(destChainId),
                txHash: eventLog.transactionHash,
                blockNumber,
                retriesLeft: this.config.maxRetries,
                eventType: "LOCK",
            };
            await this.onEvent(event);
        });
    }
    // ─── Event: Burned ────────────────────────────────────────────────────────
    _subscribeToBurned() {
        this.contract.on("Burned", async (sender, wrappedToken, amount, fee, destChainId, destRecipient, bridgeNonce, eventLog) => {
            logger_js_1.logger.info(`[EVM] Burned event | nonce: ${bridgeNonce} | amount: ${amount}`);
            const blockNumber = eventLog.blockNumber;
            await this._waitForConfirmations(blockNumber);
            const event = {
                direction: types_js_1.BridgeDirection.EVM_TO_SOLANA,
                bridgeNonce: bridgeNonce,
                sender: sender,
                recipient: bytes32ToHex(destRecipient),
                assetId: wrappedToken,
                amount: BigInt(amount.toString()),
                fee: BigInt(fee.toString()),
                srcChainId: Number((await this.provider.getNetwork()).chainId),
                destChainId: Number(destChainId),
                txHash: eventLog.transactionHash,
                blockNumber,
                retriesLeft: this.config.maxRetries,
                eventType: "BURN",
            };
            await this.onEvent(event);
        });
    }
    // ─── Write: submit relay transaction ─────────────────────────────────────
    async submitUnlockNative(params) {
        logger_js_1.logger.info(`[EVM] Submitting unlockNative | nonce: ${params.bridgeNonce}`);
        const tx = await this.contract.unlockNative(params.token, params.recipient, params.amount, params.bridgeNonce, params.originChainId, params.sig);
        const receipt = await tx.wait(1);
        logger_js_1.logger.info(`[EVM] unlockNative confirmed | tx: ${receipt?.hash}`);
        return receipt;
    }
    async submitMintWrapped(params) {
        logger_js_1.logger.info(`[EVM] Submitting mintWrapped | nonce: ${params.bridgeNonce}`);
        const tx = await this.contract.mintWrapped(params.originChainId, params.foreignAssetId, params.recipient, params.amount, params.bridgeNonce, params.sig);
        const receipt = await tx.wait(1);
        logger_js_1.logger.info(`[EVM] mintWrapped confirmed | tx: ${receipt?.hash}`);
        return receipt;
    }
    // ─── Helpers ──────────────────────────────────────────────────────────────
    async _waitForConfirmations(fromBlock) {
        const target = fromBlock + this.config.evmConfirmations;
        while (true) {
            const current = await this.provider.getBlockNumber();
            if (current >= target)
                break;
            await sleep(2000);
        }
    }
    stop() {
        this.contract.removeAllListeners();
        logger_js_1.logger.info("[EVM Listener] Stopped.");
    }
}
exports.EvmListener = EvmListener;
// ─── Utilities ────────────────────────────────────────────────────────────────
function bytes32ToHex(b32) {
    // Convert a Solidity bytes32 to full 32-byte hex (64 hex chars) with 0x prefix
    const hex = b32.startsWith("0x") ? b32.slice(2) : b32;
    return "0x" + hex.padStart(64, "0");
}
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
//# sourceMappingURL=evmListener.js.map