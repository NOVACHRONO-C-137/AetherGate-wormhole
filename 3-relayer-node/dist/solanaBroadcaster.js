"use strict";
/**
 * AetherGate Relayer — Solana Broadcaster (Solana Web3.js + Anchor)
 *
 * Polls for Anchor program logs (Locked / Burned events) on Solana.
 * Dispatches unlock or mintWrapped transactions back to EVM via the EvmListener.
 *
 * NOTE: Solana Devnet uses Chain ID 101 in AetherGate's internal scheme.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolanaBroadcaster = void 0;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const bn_js_1 = __importDefault(require("bn.js"));
const spl_token_1 = require("@solana/spl-token");
const bs58_1 = __importDefault(require("bs58"));
const types_js_1 = require("./types.js");
const logger_js_1 = require("./logger.js");
// Full Anchor IDL for the AetherGate Solana program
const AETHER_GATE_IDL = {
    version: "0.1.0",
    name: "aether_gate",
    events: [
        {
            name: "Locked",
            fields: [
                { name: "sender", type: "publicKey" },
                { name: "mint", type: "publicKey" },
                { name: "amount", type: "u64" },
                { name: "fee", type: "u64" },
                { name: "dest_chain_id", type: "u64" },
                { name: "dest_recipient", type: { array: ["u8", 32] } },
                { name: "bridge_nonce", type: { array: ["u8", 32] } },
            ],
        },
        {
            name: "Burned",
            fields: [
                { name: "sender", type: "publicKey" },
                { name: "wrapped_mint", type: "publicKey" },
                { name: "amount", type: "u64" },
                { name: "fee", type: "u64" },
                { name: "dest_chain_id", type: "u64" },
                { name: "dest_recipient", type: { array: ["u8", 32] } },
                { name: "bridge_nonce", type: { array: ["u8", 32] } },
            ],
        },
        {
            name: "WrappedMinted",
            fields: [
                { name: "bridge_nonce", type: { array: ["u8", 32] } },
                { name: "recipient", type: "publicKey" },
                { name: "wrapped_mint", type: "publicKey" },
                { name: "amount", type: "u64" },
                { name: "origin_chain_id", type: "u64" },
            ],
        },
        {
            name: "Unlocked",
            fields: [
                { name: "bridge_nonce", type: { array: ["u8", 32] } },
                { name: "recipient", type: "publicKey" },
                { name: "mint", type: "publicKey" },
                { name: "amount", type: "u64" },
                { name: "origin_chain_id", type: "u64" },
            ],
        },
    ],
    instructions: [
        {
            name: "mint_wrapped",
            accounts: [
                { name: "relayer", isMut: true, isSigner: true },
                { name: "recipient", isMut: false, isSigner: false },
                { name: "bridge_state", isMut: false, isSigner: false },
                { name: "wrapped_mint", isMut: true, isSigner: false },
                { name: "mint_authority", isMut: false, isSigner: false },
                { name: "recipient_token_account", isMut: true, isSigner: false },
                { name: "nonce_account", isMut: true, isSigner: false },
                { name: "token_program", isMut: false, isSigner: false },
                { name: "system_program", isMut: false, isSigner: false },
            ],
            args: [
                { name: "amount", type: "u64" },
                { name: "bridge_nonce", type: { array: ["u8", 32] } },
                { name: "origin_chain_id", type: "u64" },
            ],
        },
        {
            name: "unlock_native",
            accounts: [
                { name: "relayer", isMut: true, isSigner: true },
                { name: "recipient", isMut: false, isSigner: false },
                { name: "bridge_state", isMut: false, isSigner: false },
                { name: "mint", isMut: false, isSigner: false },
                { name: "vault_authority", isMut: false, isSigner: false },
                { name: "vault_token_account", isMut: true, isSigner: false },
                { name: "recipient_token_account", isMut: true, isSigner: false },
                { name: "nonce_account", isMut: true, isSigner: false },
                { name: "token_program", isMut: false, isSigner: false },
                { name: "system_program", isMut: false, isSigner: false },
                { name: "associated_token_program", isMut: false, isSigner: false },
            ],
            args: [
                { name: "amount", type: "u64" },
                { name: "bridge_nonce", type: { array: ["u8", 32] } },
                { name: "origin_chain_id", type: "u64" },
            ],
        },
    ],
    accounts: [],
};
const BRIDGE_SEED = "bridge";
const VAULT_SEED = "vault";
const MINT_AUTH_SEED = "mint_auth";
const NONCE_SEED = "nonce";
class SolanaBroadcaster {
    config;
    onEvent;
    connection;
    relayerKeypair;
    program;
    lastSignature;
    pollTimer;
    constructor(config, onEvent) {
        this.config = config;
        this.onEvent = onEvent;
        this.connection = new web3_js_1.Connection(config.solanaRpcUrl, "confirmed");
        this.relayerKeypair = web3_js_1.Keypair.fromSecretKey(bs58_1.default.decode(config.relayerSolanaKey));
        const wallet = {
            publicKey: this.relayerKeypair.publicKey,
            payer: this.relayerKeypair,
            signTransaction: async (tx) => {
                if ("partialSign" in tx) {
                    tx.partialSign(this.relayerKeypair);
                }
                return tx;
            },
            signAllTransactions: async (txs) => {
                txs.forEach(tx => {
                    if ("partialSign" in tx) {
                        tx.partialSign(this.relayerKeypair);
                    }
                });
                return txs;
            },
        };
        const provider = new anchor_1.AnchorProvider(this.connection, wallet, {
            commitment: "confirmed",
        });
        this.program = new anchor_1.Program(AETHER_GATE_IDL, new web3_js_1.PublicKey(config.solanaProgramId), provider);
        logger_js_1.logger.info(`[Solana] Broadcaster ready. Program: ${config.solanaProgramId}`);
        logger_js_1.logger.info(`[Solana] Chain ID 101 = Solana Devnet in AetherGate routing`);
    }
    start() {
        logger_js_1.logger.info(`[Solana] Polling every ${this.config.solanaPollIntervalMs}ms`);
        this.pollTimer = setInterval(() => this._poll().catch((e) => logger_js_1.logger.error("[Solana] Poll error:", e)), this.config.solanaPollIntervalMs);
    }
    stop() {
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        logger_js_1.logger.info("[Solana] Broadcaster stopped.");
    }
    // ─── Polling ──────────────────────────────────────────────────────────────
    async _poll() {
        const programId = new web3_js_1.PublicKey(this.config.solanaProgramId);
        const sigs = await this.connection.getSignaturesForAddress(programId, {
            limit: 20,
            until: this.lastSignature,
        });
        if (sigs.length === 0)
            return;
        this.lastSignature = sigs[0].signature;
        for (const sigInfo of sigs.reverse()) {
            if (sigInfo.err)
                continue;
            await this._processTransaction(sigInfo.signature);
        }
    }
    async _processTransaction(signature) {
        const tx = await this.connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
        });
        if (!tx?.meta?.logMessages)
            return;
        const events = this._parseEvents(tx.meta.logMessages);
        for (const { name, data } of events) {
            await this._handleParsedEvent(name, data, signature, tx.slot);
        }
    }
    _parseEvents(logs) {
        const results = [];
        const eventPrefix = "Program data: ";
        for (const log of logs) {
            if (!log.startsWith(eventPrefix))
                continue;
            try {
                const b64 = log.slice(eventPrefix.length);
                const buf = Buffer.from(b64, "base64");
                const decoded = this.program.coder.events.decode(buf.toString("base64"));
                if (decoded) {
                    results.push({ name: decoded.name, data: decoded.data });
                }
            }
            catch {
                // Not an AetherGate event
            }
        }
        return results;
    }
    // ─── Write methods ────────────────────────────────────────────────────────
    async submitMintWrapped(params) {
        const programId = new web3_js_1.PublicKey(this.config.solanaProgramId);
        const normalize = (p) => {
            if (typeof p === "string") {
                if (p.startsWith("0x")) {
                    const hex = p.slice(2);
                    return new web3_js_1.PublicKey(Buffer.from(hex, "hex"));
                }
                else {
                    return new web3_js_1.PublicKey(p);
                }
            }
            return p;
        };
        const recipient = normalize(params.recipient);
        const mint = normalize(params.wrappedMint);
        const [bridgeState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from(BRIDGE_SEED)], programId);
        const [mintAuthority] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from(MINT_AUTH_SEED), mint.toBuffer()], programId);
        const nonceBytes = Buffer.from(params.bridgeNonce);
        if (nonceBytes.length !== 32) {
            throw new Error(`Invalid bridgeNonce length: expected 32 bytes, got ${nonceBytes.length}`);
        }
        const [nonceAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from(NONCE_SEED), nonceBytes], programId);
        const [recipientTokenAccount] = web3_js_1.PublicKey.findProgramAddressSync([recipient.toBuffer(), spl_token_1.TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
        try {
            const signature = await this.program.methods
                .mintWrapped(new bn_js_1.default(params.amount.toString()), Array.from(nonceBytes), new bn_js_1.default(params.originChainId))
                .accounts({
                relayer: this.relayerKeypair.publicKey,
                recipient,
                bridgeState,
                wrappedMint: mint,
                mintAuthority,
                recipientTokenAccount,
                nonceAccount,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
            })
                .rpc();
            logger_js_1.logger.info(`[Solana] mintWrapped tx: ${signature}`);
            return signature;
        }
        catch (error) {
            logger_js_1.logger.error("[Solana] mintWrapped error:", error);
            throw error;
        }
    }
    async submitUnlockNative(params) {
        const programId = new web3_js_1.PublicKey(this.config.solanaProgramId);
        const normalize = (p) => {
            if (typeof p === "string") {
                if (p.startsWith("0x")) {
                    const hex = p.slice(2);
                    return new web3_js_1.PublicKey(Buffer.from(hex, "hex"));
                }
                else {
                    return new web3_js_1.PublicKey(p);
                }
            }
            return p;
        };
        const mint = normalize(params.mint);
        const recipient = normalize(params.recipient);
        const [bridgeState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from(BRIDGE_SEED)], programId);
        const [vaultAuthority] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from(VAULT_SEED), mint.toBuffer()], programId);
        const [vaultTokenAccount] = web3_js_1.PublicKey.findProgramAddressSync([vaultAuthority.toBuffer(), spl_token_1.TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
        const [recipientTokenAccount] = web3_js_1.PublicKey.findProgramAddressSync([recipient.toBuffer(), spl_token_1.TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID);
        const nonceBytes = Buffer.from(params.bridgeNonce);
        if (nonceBytes.length !== 32) {
            throw new Error(`Invalid bridgeNonce length: expected 32 bytes, got ${nonceBytes.length}`);
        }
        const [nonceAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from(NONCE_SEED), nonceBytes], programId);
        try {
            const signature = await this.program.methods
                .unlockNative(new bn_js_1.default(params.amount.toString()), Array.from(nonceBytes), new bn_js_1.default(params.originChainId))
                .accounts({
                relayer: this.relayerKeypair.publicKey,
                recipient,
                bridgeState,
                mint,
                vaultAuthority,
                vaultTokenAccount,
                recipientTokenAccount,
                nonceAccount,
                tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
                systemProgram: web3_js_1.SystemProgram.programId,
                associatedTokenProgram: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
            })
                .rpc();
            logger_js_1.logger.info(`[Solana] unlockNative tx: ${signature}`);
            return signature;
        }
        catch (error) {
            logger_js_1.logger.error("[Solana] unlockNative error:", error);
            throw error;
        }
    }
    // ─── Event handlers ───────────────────────────────────────────────────────
    async _handleParsedEvent(name, data, txHash, slot) {
        if (name === "Locked") {
            logger_js_1.logger.info(`[Solana] Locked event | nonce: ${bufToHex(data.bridge_nonce)}`);
            const event = {
                direction: types_js_1.BridgeDirection.SOLANA_TO_EVM,
                bridgeNonce: bufToHex(data.bridge_nonce),
                sender: data.sender.toBase58(),
                recipient: bufToHex(data.dest_recipient),
                assetId: data.mint.toBase58(),
                amount: BigInt(data.amount.toString()),
                fee: BigInt(data.fee.toString()),
                srcChainId: this.config.solanaChainId,
                destChainId: Number(data.dest_chain_id.toString()),
                txHash,
                blockNumber: slot,
                retriesLeft: this.config.maxRetries,
                eventType: "LOCK",
            };
            await this.onEvent(event);
        }
        else if (name === "Burned") {
            logger_js_1.logger.info(`[Solana] Burned event | nonce: ${bufToHex(data.bridge_nonce)}`);
            const event = {
                direction: types_js_1.BridgeDirection.SOLANA_TO_EVM,
                bridgeNonce: bufToHex(data.bridge_nonce),
                sender: data.sender.toBase58(),
                recipient: bufToHex(data.dest_recipient),
                assetId: data.wrapped_mint.toBase58(),
                amount: BigInt(data.amount.toString()),
                fee: BigInt(data.fee.toString()),
                srcChainId: this.config.solanaChainId,
                destChainId: Number(data.dest_chain_id.toString()),
                txHash,
                blockNumber: slot,
                retriesLeft: this.config.maxRetries,
                eventType: "BURN",
            };
            await this.onEvent(event);
        }
    }
}
exports.SolanaBroadcaster = SolanaBroadcaster;
// ─── Utilities ───────────────────────────────────────────────────────────────
function bufToHex(buf) {
    return "0x" + Buffer.from(buf).toString("hex");
}
//# sourceMappingURL=solanaBroadcaster.js.map