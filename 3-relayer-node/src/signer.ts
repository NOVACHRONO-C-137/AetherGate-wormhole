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

import { ethers } from "ethers";
import { logger } from "./logger.js";

export class SigningModule {
  private readonly wallet: ethers.Wallet;
  /** Chain ID of the EVM contract we are signing for. */
  public readonly evmChainId: bigint;

  constructor(privateKey: string, evmChainId: number) {
    this.wallet     = new ethers.Wallet(privateKey);
    this.evmChainId = BigInt(evmChainId);
    logger.info(`[Signer] Relayer EVM address: ${this.wallet.address}`);
  }

  get address(): string {
    return this.wallet.address;
  }

  // ─── unlockNative signature ─────────────────────────────────────────────────

  /**
   * Build and sign the payload hash for unlockNative().
   * Must match _buildUnlockHash() in VaultBridge.sol.
   */
  async signUnlock(params: {
    token:          string;
    recipient:      string;
    amount:         bigint;
    bridgeNonce:    string; // bytes32 hex
    originChainId:  number;
  }): Promise<string> {
    const packed = ethers.solidityPacked(
      ["string", "uint256", "address", "address", "uint256", "bytes32", "uint256"],
      [
        "AETHERGATE_UNLOCK",
        this.evmChainId,
        params.token,
        params.recipient,
        params.amount,
        params.bridgeNonce,
        params.originChainId,
      ]
    );
    const msgHash = ethers.keccak256(packed);
    const sig     = await this.wallet.signMessage(ethers.getBytes(msgHash));
    logger.debug(`[Signer] unlockNative sig: ${sig} for nonce ${params.bridgeNonce}`);
    return sig;
  }

  // ─── mintWrapped signature ──────────────────────────────────────────────────

  /**
   * Build and sign the payload hash for mintWrapped().
   * Must match _buildMintHash() in VaultBridge.sol.
   */
  async signMint(params: {
    originChainId:  number;
    foreignAssetId: string; // bytes32 hex (Solana mint encoded)
    recipient:      string;
    amount:         bigint;
    bridgeNonce:    string; // bytes32 hex
  }): Promise<string> {
    const packed = ethers.solidityPacked(
      ["string", "uint256", "uint256", "bytes32", "address", "uint256", "bytes32"],
      [
        "AETHERGATE_MINT",
        this.evmChainId,
        params.originChainId,
        params.foreignAssetId,
        params.recipient,
        params.amount,
        params.bridgeNonce,
      ]
    );
    const msgHash = ethers.keccak256(packed);
    const sig     = await this.wallet.signMessage(ethers.getBytes(msgHash));
    logger.debug(`[Signer] mintWrapped sig: ${sig} for nonce ${params.bridgeNonce}`);
    return sig;
  }
}
