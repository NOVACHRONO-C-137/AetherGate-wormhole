/**
 * AetherGate Relayer — Signing Module
 *
 * Produces ECDSA signatures over relay payloads. The VaultBridge.sol contract
 * verifies these signatures on-chain (keccak256 + toEthSignedMessageHash).
 *
 * Signature scheme:
 *   unlockNative: keccak256("AETHERGATE_UNLOCK" | chainId | token | recipient | amount | bridgeNonce | originChainId)
 *   mintWrapped:  keccak256("AETHERGATE_MINT"   | chainId | originChainId | foreignAssetId | recipient | amount | bridgeNonce)
 */
export declare class SigningModule {
    private readonly wallet;
    /** Chain ID of the EVM contract we are signing for. */
    readonly evmChainId: bigint;
    constructor(privateKey: string, evmChainId: number);
    get address(): string;
    /**
     * Build and sign the payload hash for unlockNative().
     * Must match _buildUnlockHash() in VaultBridge.sol.
     */
    signUnlock(params: {
        token: string;
        recipient: string;
        amount: bigint;
        bridgeNonce: string;
        originChainId: number;
    }): Promise<string>;
    /**
     * Build and sign the payload hash for mintWrapped().
     * Must match _buildMintHash() in VaultBridge.sol.
     */
    signMint(params: {
        originChainId: number;
        foreignAssetId: string;
        recipient: string;
        amount: bigint;
        bridgeNonce: string;
    }): Promise<string>;
}
//# sourceMappingURL=signer.d.ts.map