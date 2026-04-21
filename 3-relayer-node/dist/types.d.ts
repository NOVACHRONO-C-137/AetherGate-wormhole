/**
 * AetherGate Relayer — Shared Types
 * Defines the canonical event structures used throughout the relayer pipeline.
 */
export declare enum BridgeDirection {
    EVM_TO_SOLANA = "EVM_TO_SOL",
    SOLANA_TO_EVM = "SOL_TO_EVM"
}
export interface BridgeEvent {
    direction: BridgeDirection;
    bridgeNonce: string;
    sender: string;
    recipient: string;
    assetId: string;
    amount: bigint;
    fee: bigint;
    srcChainId: number;
    destChainId: number;
    txHash: string;
    blockNumber: number;
    retriesLeft: number;
    eventType: "LOCK" | "BURN";
}
export interface RelayerConfig {
    evmRpcUrl: string;
    evmVaultBridgeAddress: string;
    relayerEvmPrivateKey: string;
    solanaRpcUrl: string;
    solanaChainId: number;
    relayerSolanaKey: string;
    solanaProgramId: string;
    solanaPollIntervalMs: number;
    evmConfirmations: number;
    maxRetries: number;
    /** Optional mapping from EVM token address (lowercase, no 0x) to Solana wrapped mint (Base58 pubkey) */
    evmToSolWrappedMint?: Record<string, string>;
    /** Optional mapping from EVM wrapped token address (lowercase) to Solana native mint (Base58 pubkey) */
    evmWrappedToSolNative?: Record<string, string>;
}
//# sourceMappingURL=types.d.ts.map