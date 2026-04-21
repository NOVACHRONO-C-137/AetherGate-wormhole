/**
 * AetherGate Relayer — EVM Listener (Ethers.js v6)
 *
 * Subscribes to VaultBridge events:
 *   • Locked  → relay to Solana (mintWrapped on EVM side = unlock on Solana)
 *   • Burned  → relay to EVM    (unlockNative)
 *
 * Uses a persistent WebSocket provider with auto-reconnect.
 */
import { ethers } from "ethers";
import { BridgeEvent, RelayerConfig } from "./types.js";
export declare class EvmListener {
    private readonly config;
    private readonly onEvent;
    private provider;
    private contract;
    private relayerWallet;
    constructor(config: RelayerConfig, onEvent: (event: BridgeEvent) => Promise<void>);
    start(): Promise<void>;
    private _subscribeToLocked;
    private _subscribeToBurned;
    submitUnlockNative(params: {
        token: string;
        recipient: string;
        amount: bigint;
        bridgeNonce: string;
        originChainId: number;
        sig: string;
    }): Promise<ethers.TransactionReceipt | null>;
    submitMintWrapped(params: {
        originChainId: number;
        foreignAssetId: string;
        recipient: string;
        amount: bigint;
        bridgeNonce: string;
        sig: string;
    }): Promise<ethers.TransactionReceipt | null>;
    private _waitForConfirmations;
    stop(): void;
}
//# sourceMappingURL=evmListener.d.ts.map