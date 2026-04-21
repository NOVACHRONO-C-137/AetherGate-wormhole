/**
 * AetherGate Relayer — Solana Broadcaster (Solana Web3.js + Anchor)
 *
 * Polls for Anchor program logs (Locked / Burned events) on Solana.
 * Dispatches unlock or mintWrapped transactions back to EVM via the EvmListener.
 *
 * NOTE: Solana Devnet uses Chain ID 101 in AetherGate's internal scheme.
 */
import { PublicKey } from "@solana/web3.js";
import { BridgeEvent, RelayerConfig } from "./types.js";
export declare class SolanaBroadcaster {
    private readonly config;
    private readonly onEvent;
    private connection;
    private relayerKeypair;
    private program;
    private lastSignature;
    private pollTimer?;
    constructor(config: RelayerConfig, onEvent: (event: BridgeEvent) => Promise<void>);
    start(): void;
    stop(): void;
    private _poll;
    private _processTransaction;
    private _parseEvents;
    submitMintWrapped(params: {
        wrappedMint: PublicKey | string;
        recipient: PublicKey | string;
        amount: bigint;
        bridgeNonce: number[];
        originChainId: number;
    }): Promise<string>;
    submitUnlockNative(params: {
        mint: PublicKey | string;
        recipient: PublicKey | string;
        amount: bigint;
        bridgeNonce: number[];
        originChainId: number;
    }): Promise<string>;
    private _handleParsedEvent;
}
//# sourceMappingURL=solanaBroadcaster.d.ts.map