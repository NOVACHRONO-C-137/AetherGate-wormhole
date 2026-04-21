"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SigningModule = void 0;
const ethers_1 = require("ethers");
const logger_js_1 = require("./logger.js");
class SigningModule {
    wallet;
    /** Chain ID of the EVM contract we are signing for. */
    evmChainId;
    constructor(privateKey, evmChainId) {
        this.wallet = new ethers_1.ethers.Wallet(privateKey);
        this.evmChainId = BigInt(evmChainId);
        logger_js_1.logger.info(`[Signer] Relayer EVM address: ${this.wallet.address}`);
    }
    get address() {
        return this.wallet.address;
    }
    // ─── unlockNative signature ─────────────────────────────────────────────────
    /**
     * Build and sign the payload hash for unlockNative().
     * Must match _buildUnlockHash() in VaultBridge.sol.
     */
    async signUnlock(params) {
        const packed = ethers_1.ethers.solidityPacked(["string", "uint256", "address", "address", "uint256", "bytes32", "uint256"], [
            "AETHERGATE_UNLOCK",
            this.evmChainId,
            params.token,
            params.recipient,
            params.amount,
            params.bridgeNonce,
            params.originChainId,
        ]);
        const msgHash = ethers_1.ethers.keccak256(packed);
        const sig = await this.wallet.signMessage(ethers_1.ethers.getBytes(msgHash));
        logger_js_1.logger.debug(`[Signer] unlockNative sig: ${sig} for nonce ${params.bridgeNonce}`);
        return sig;
    }
    // ─── mintWrapped signature ──────────────────────────────────────────────────
    /**
     * Build and sign the payload hash for mintWrapped().
     * Must match _buildMintHash() in VaultBridge.sol.
     */
    async signMint(params) {
        const packed = ethers_1.ethers.solidityPacked(["string", "uint256", "uint256", "bytes32", "address", "uint256", "bytes32"], [
            "AETHERGATE_MINT",
            this.evmChainId,
            params.originChainId,
            params.foreignAssetId,
            params.recipient,
            params.amount,
            params.bridgeNonce,
        ]);
        const msgHash = ethers_1.ethers.keccak256(packed);
        const sig = await this.wallet.signMessage(ethers_1.ethers.getBytes(msgHash));
        logger_js_1.logger.debug(`[Signer] mintWrapped sig: ${sig} for nonce ${params.bridgeNonce}`);
        return sig;
    }
}
exports.SigningModule = SigningModule;
//# sourceMappingURL=signer.js.map