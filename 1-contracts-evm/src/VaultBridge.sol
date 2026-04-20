// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ██████╗ ███████╗████████╗██╗  ██╗███████╗██████╗  ██████╗  █████╗ ████████╗███████╗
 * ██╔══██╗██╔════╝╚══██╔══╝██║  ██║██╔════╝██╔══██╗██╔════╝ ██╔══██╗╚══██╔══╝██╔════╝
 * ███████║█████╗     ██║   ███████║█████╗  ██████╔╝██║  ███╗███████║   ██║   █████╗
 * ██╔══██║██╔══╝     ██║   ██╔══██║██╔══╝  ██╔══██╗██║   ██║██╔══██║   ██║   ██╔══╝
 * ██║  ██║███████╗   ██║   ██║  ██║███████╗██║  ██║╚██████╔╝██║  ██║   ██║   ███████╗
 * ╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝
 *
 *  AetherGate — VaultBridge v1.0
 *  Layer-0 Bidirectional EVM ↔ Solana Cross-Chain Bridge
 *
 *  ARCHITECTURE OVERVIEW
 *  ─────────────────────
 *  • lockNative()    — Lock ETH/ERC-20 into vault → emits Locked → relayer mints on Solana
 *  • unlockNative()  — Relayer-authorized release of locked assets (post burn on Solana)
 *  • mintWrapped()   — Relayer mints a wrapped ERC-20 representing a Solana-native asset
 *  • burnWrapped()   — Burn wrapped ERC-20 → emits Burned → relayer unlocks on Solana
 *
 *  SECURITY MODEL
 *  ──────────────
 *  • ECDSA relayer signature verification on every state-mutating relayer call
 *  • Nonce-based replay protection (per origin chain, per nonce)
 *  • Role-based access control (DEFAULT_ADMIN, RELAYER_ROLE, PAUSER_ROLE)
 *  • Reentrancy guard on all value-moving functions
 *  • Emergency pause via PauserRole
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ─────────────────────────────────────────────
//  Minimal WrappedToken — deployed per foreign asset
// ─────────────────────────────────────────────
contract WrappedToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint8 private _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address admin_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MINTER_ROLE, admin_);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Bridge-only mint — only MINTER_ROLE (the VaultBridge) may call.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Bridge-only burn.
    function burn(address from, uint256 amount) external onlyRole(MINTER_ROLE) {
        _burn(from, amount);
    }
}

// ─────────────────────────────────────────────
//  VaultBridge — main bridge contract
// ─────────────────────────────────────────────
contract VaultBridge is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ─── Roles ───────────────────────────────
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant PAUSER_ROLE  = keccak256("PAUSER_ROLE");

    // ─── Chain identification ─────────────────
    /// @dev Chain ID of this deployment (set at construction, immutable).
    uint256 public immutable CHAIN_ID;

    // ─── Protocol fee ─────────────────────────
    /// @notice Fee in basis points (e.g. 10 = 0.10 %).
    uint256 public feeBps;
    address public feeRecipient;

    // ─── Supported tokens ─────────────────────
    /// @notice Token address → isSupported flag (for native-side locking).
    mapping(address => bool) public supportedTokens;

    // ─── Wrapped token registry ────────────────
    /// @notice foreignChainId + foreignAssetId (bytes32) → deployed WrappedToken
    mapping(uint256 => mapping(bytes32 => address)) public wrappedTokens;

    // ─── Replay protection ────────────────────
    /// @notice originChain → nonce → executed?
    mapping(uint256 => mapping(bytes32 => bool)) public processedNonces;

    // ─── ETH vault balance ────────────────────
    uint256 public ethVaultBalance;

    // ─────────────────────────────────────────
    //  Events (consumed by the Relayer)
    // ─────────────────────────────────────────

    /// @notice Emitted when a user locks native ERC-20 or ETH.
    event Locked(
        address indexed sender,
        address indexed token,    // address(0) = ETH
        uint256         amount,
        uint256         fee,
        uint256         destChainId,
        bytes32         destRecipient,  // encoded Solana public key
        bytes32 indexed bridgeNonce     // unique id for this transfer leg
    );

    /// @notice Emitted when the relayer releases locked assets back to user.
    event Unlocked(
        bytes32 indexed bridgeNonce,
        address indexed recipient,
        address indexed token,
        uint256         amount
    );

    /// @notice Emitted when a wrapped token representing a Solana asset is minted.
    event WrappedMinted(
        bytes32 indexed bridgeNonce,
        address indexed recipient,
        address indexed wrappedToken,
        uint256         amount,
        uint256         originChainId
    );

    /// @notice Emitted when a wrapped token is burned to unlock on the origin chain.
    event Burned(
        address indexed sender,
        address indexed wrappedToken,
        uint256         amount,
        uint256         fee,
        uint256         destChainId,
        bytes32         destRecipient,
        bytes32 indexed bridgeNonce
    );

    /// @notice Admin support token toggled.
    event TokenSupportUpdated(address indexed token, bool supported);

    /// @notice New wrapped token deployed.
    event WrappedTokenDeployed(
        uint256 indexed originChainId,
        bytes32 indexed foreignAssetId,
        address         wrappedToken
    );

    /// @notice Fee updated.
    event FeeUpdated(uint256 newFeeBps, address newRecipient);

    // ─────────────────────────────────────────
    //  Errors
    // ─────────────────────────────────────────
    error UnsupportedToken(address token);
    error AmountZero();
    error InvalidSignature();
    error NonceAlreadyProcessed(bytes32 nonce);
    error WrappedTokenNotFound(uint256 chainId, bytes32 assetId);
    error WrappedTokenAlreadyExists(uint256 chainId, bytes32 assetId);
    error EthTransferFailed();
    error InvalidFee();

    // ─────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────
    constructor(
        address admin_,
        address relayer_,
        address feeRecipient_,
        uint256 feeBps_,
        uint256 chainId_
    ) {
        require(feeBps_ <= 1000, "Fee > 10%"); // hard cap
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(RELAYER_ROLE, relayer_);
        _grantRole(PAUSER_ROLE, admin_);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        CHAIN_ID = chainId_;
    }

    // ─────────────────────────────────────────
    //  Admin functions
    // ─────────────────────────────────────────

    /// @notice Toggle support for a native ERC-20 token (or address(0) for ETH).
    function setSupportedToken(address token, bool supported)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    /// @notice Update protocol fee.
    function setFee(uint256 newFeeBps, address newRecipient)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (newFeeBps > 1000) revert InvalidFee();
        feeBps = newFeeBps;
        feeRecipient = newRecipient;
        emit FeeUpdated(newFeeBps, newRecipient);
    }

    /// @notice Deploy and register a WrappedToken for a foreign asset.
    function deployWrappedToken(
        uint256 originChainId,
        bytes32 foreignAssetId,
        string  calldata name,
        string  calldata symbol,
        uint8   decimals_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (address) {
        if (wrappedTokens[originChainId][foreignAssetId] != address(0))
            revert WrappedTokenAlreadyExists(originChainId, foreignAssetId);

        WrappedToken wt = new WrappedToken(name, symbol, decimals_, address(this));
        wrappedTokens[originChainId][foreignAssetId] = address(wt);

        emit WrappedTokenDeployed(originChainId, foreignAssetId, address(wt));
        return address(wt);
    }

    function pause()   external onlyRole(PAUSER_ROLE) { _pause();   }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ─────────────────────────────────────────
    //  CORE: lockNative
    // ─────────────────────────────────────────

    /**
     * @notice Lock ERC-20 tokens into the vault to bridge them to `destChainId`.
     *         The relayer watches for {Locked} events and mints wrapped tokens
     *         on the destination chain after verifying the event.
     *
     * @param token         ERC-20 token address (must be supported).
     * @param amount        Raw token amount (before fee deduction).
     * @param destChainId   Target chain ID (e.g. 101 for Solana Devnet).
     * @param destRecipient Encoded destination account (Solana pubkey as bytes32).
     */
    function lockNative(
        address token,
        uint256 amount,
        uint256 destChainId,
        bytes32 destRecipient
    ) external nonReentrant whenNotPaused {
        if (!supportedTokens[token]) revert UnsupportedToken(token);
        if (amount == 0) revert AmountZero();

        (uint256 fee, uint256 netAmount) = _computeFee(amount);

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        if (fee > 0) {
            IERC20(token).safeTransfer(feeRecipient, fee);
        }

        bytes32 nonce = _generateNonce(msg.sender, token, netAmount, destChainId, destRecipient);

        emit Locked(msg.sender, token, netAmount, fee, destChainId, destRecipient, nonce);
    }

    /**
     * @notice Lock native ETH into the vault.
     * @param destChainId   Target chain ID.
     * @param destRecipient Encoded destination account.
     */
    function lockNativeETH(
        uint256 destChainId,
        bytes32 destRecipient
    ) external payable nonReentrant whenNotPaused {
        if (!supportedTokens[address(0)]) revert UnsupportedToken(address(0));
        if (msg.value == 0) revert AmountZero();

        (uint256 fee, uint256 netAmount) = _computeFee(msg.value);

        if (fee > 0) {
            (bool ok,) = feeRecipient.call{value: fee}("");
            if (!ok) revert EthTransferFailed();
        }

        ethVaultBalance += netAmount;
        bytes32 nonce = _generateNonce(msg.sender, address(0), netAmount, destChainId, destRecipient);

        emit Locked(msg.sender, address(0), netAmount, fee, destChainId, destRecipient, nonce);
    }

    // ─────────────────────────────────────────
    //  CORE: unlockNative
    // ─────────────────────────────────────────

    /**
     * @notice Unlock (release) previously locked tokens to a recipient.
     *         Called by the relayer after it verifies a burn event on Solana.
     *
     * @param token         ERC-20 address, or address(0) for ETH.
     * @param recipient     Address to receive unlocked assets.
     * @param amount        Net amount to release.
     * @param bridgeNonce   The unique nonce from the Solana burn event.
     * @param originChainId Chain where the burn event originated.
     * @param sig           ECDSA signature from the authorized relayer over the payload hash.
     */
    function unlockNative(
        address token,
        address recipient,
        uint256 amount,
        bytes32 bridgeNonce,
        uint256 originChainId,
        bytes calldata sig
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        if (amount == 0) revert AmountZero();
        if (processedNonces[originChainId][bridgeNonce])
            revert NonceAlreadyProcessed(bridgeNonce);

        // Verify relayer signature
        bytes32 msgHash = _buildUnlockHash(token, recipient, amount, bridgeNonce, originChainId);
        _verifySignature(msgHash, sig);

        processedNonces[originChainId][bridgeNonce] = true;

        if (token == address(0)) {
            ethVaultBalance -= amount;
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }

        emit Unlocked(bridgeNonce, recipient, token, amount);
    }

    // ─────────────────────────────────────────
    //  CORE: mintWrapped
    // ─────────────────────────────────────────

    /**
     * @notice Mint a wrapped ERC-20 representing a Solana-native asset.
     *         Called by the relayer after detecting a lock event on Solana.
     *
     * @param originChainId  Chain ID of the origin (e.g. 101 for Solana Devnet).
     * @param foreignAssetId Identifier of the Solana mint (encoded as bytes32).
     * @param recipient      EVM address to receive wrapped tokens.
     * @param amount         Amount of wrapped tokens to mint.
     * @param bridgeNonce    Unique nonce from the Solana lock event.
     * @param sig            ECDSA signature from the authorized relayer.
     */
    function mintWrapped(
        uint256 originChainId,
        bytes32 foreignAssetId,
        address recipient,
        uint256 amount,
        bytes32 bridgeNonce,
        bytes calldata sig
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        if (amount == 0) revert AmountZero();
        if (processedNonces[originChainId][bridgeNonce])
            revert NonceAlreadyProcessed(bridgeNonce);

        address wtAddr = wrappedTokens[originChainId][foreignAssetId];
        if (wtAddr == address(0)) revert WrappedTokenNotFound(originChainId, foreignAssetId);

        // Verify relayer signature
        bytes32 msgHash = _buildMintHash(originChainId, foreignAssetId, recipient, amount, bridgeNonce);
        _verifySignature(msgHash, sig);

        processedNonces[originChainId][bridgeNonce] = true;

        WrappedToken(wtAddr).mint(recipient, amount);

        emit WrappedMinted(bridgeNonce, recipient, wtAddr, amount, originChainId);
    }

    // ─────────────────────────────────────────
    //  CORE: burnWrapped
    // ─────────────────────────────────────────

    /**
     * @notice Burn a wrapped ERC-20 to initiate unlocking on the origin chain.
     *         The relayer watches for {Burned} events and unlocks on Solana.
     *
     * @param originChainId  Origin chain of the wrapped asset.
     * @param foreignAssetId Identifier of the foreign Solana mint.
     * @param amount         Amount to burn.
     * @param destChainId    Must equal originChainId (unlock destination).
     * @param destRecipient  Encoded destination account (Solana pubkey).
     */
    function burnWrapped(
        uint256 originChainId,
        bytes32 foreignAssetId,
        uint256 amount,
        uint256 destChainId,
        bytes32 destRecipient
    ) external nonReentrant whenNotPaused {
        if (amount == 0) revert AmountZero();

        address wtAddr = wrappedTokens[originChainId][foreignAssetId];
        if (wtAddr == address(0)) revert WrappedTokenNotFound(originChainId, foreignAssetId);

        (uint256 fee, uint256 netAmount) = _computeFee(amount);

        // Burn user tokens (net after fee — fee stays as wrapped for protocol)
        WrappedToken(wtAddr).burn(msg.sender, amount);

        // Mint fee to feeRecipient as wrapped token
        if (fee > 0) {
            WrappedToken(wtAddr).mint(feeRecipient, fee);
        }

        bytes32 nonce = _generateNonce(msg.sender, wtAddr, netAmount, destChainId, destRecipient);

        emit Burned(msg.sender, wtAddr, netAmount, fee, destChainId, destRecipient, nonce);
    }

    // ─────────────────────────────────────────────
    //  Internal helpers
    // ─────────────────────────────────────────────

    function _computeFee(uint256 amount) internal view returns (uint256 fee, uint256 net) {
        fee = (amount * feeBps) / 10_000;
        net = amount - fee;
    }

    /**
     * @dev Generates a unique nonce for each bridge operation.
     *
     *  abi.encodePacked layout (264 bytes = 0x108):
     *  ┌────────────┬───────┬────────┐
     *  │ Field      │ Bytes │ Offset │
     *  ├────────────┼───────┼────────┤
     *  │ chainid    │  32   │ 0x00   │
     *  │ CHAIN_ID   │  32   │ 0x20   │
     *  │ sender     │  20   │ 0x40   │
     *  │ token      │  20   │ 0x54   │
     *  │ amount     │  32   │ 0x68   │
     *  │ destChain  │  32   │ 0x88   │
     *  │ destRecip  │  32   │ 0xa8   │
     *  │ timestamp  │  32   │ 0xc8   │
     *  │ prevrandao │  32   │ 0xe8   │
     *  └────────────┴───────┴────────┘
     */
    function _generateNonce(
        address sender,
        address token,
        uint256 amount,
        uint256 destChainId,
        bytes32 destRecipient
    ) internal view returns (bytes32 result) {
        uint256 immutableChainId = CHAIN_ID;
        /// @solidity memory-safe-assembly
        assembly {
            let ptr := mload(0x40)
            mstore(ptr,            chainid())        // [0x00..0x20)  block.chainid
            mstore(add(ptr, 0x20), immutableChainId) // [0x20..0x40)  CHAIN_ID
            mstore(add(ptr, 0x40), shl(96, sender))  // [0x40..0x54)  sender  (20 bytes)
            mstore(add(ptr, 0x54), shl(96, token))   // [0x54..0x68)  token   (20 bytes)
            mstore(add(ptr, 0x68), amount)           // [0x68..0x88)  amount
            mstore(add(ptr, 0x88), destChainId)      // [0x88..0xa8)  destChainId
            mstore(add(ptr, 0xa8), destRecipient)    // [0xa8..0xc8)  destRecipient
            mstore(add(ptr, 0xc8), timestamp())      // [0xc8..0xe8)  block.timestamp
            mstore(add(ptr, 0xe8), prevrandao())     // [0xe8..0x108) block.prevrandao
            result := keccak256(ptr, 0x108)          // hash 264 bytes
        }
    }

    /**
     * @dev Builds the unlock message hash for relayer signature verification.
     *
     *  abi.encodePacked layout (185 bytes = 0xb9):
     *  ┌─────────────────────┬───────┬────────┐
     *  │ Field               │ Bytes │ Offset │
     *  ├─────────────────────┼───────┼────────┤
     *  │ "AETHERGATE_UNLOCK" │  17   │ 0x00   │
     *  │ CHAIN_ID            │  32   │ 0x11   │
     *  │ token               │  20   │ 0x31   │
     *  │ recipient           │  20   │ 0x45   │
     *  │ amount              │  32   │ 0x59   │
     *  │ bridgeNonce         │  32   │ 0x79   │
     *  │ originChainId       │  32   │ 0x99   │
     *  └─────────────────────┴───────┴────────┘
     */
    function _buildUnlockHash(
        address token,
        address recipient,
        uint256 amount,
        bytes32 bridgeNonce,
        uint256 originChainId
    ) internal view returns (bytes32) {
        uint256 immutableChainId = CHAIN_ID;
        bytes32 innerHash;
        /// @solidity memory-safe-assembly
        assembly {
            let ptr := mload(0x40)
            //  "AETHERGATE_UNLOCK" = 0x414554484552474154455f554e4c4f434b
            mstore(ptr, 0x414554484552474154455f554e4c4f434b000000000000000000000000000000)
            mstore(add(ptr, 0x11), immutableChainId)  // [0x11..0x31)
            mstore(add(ptr, 0x31), shl(96, token))    // [0x31..0x45)  20 bytes
            mstore(add(ptr, 0x45), shl(96, recipient))// [0x45..0x59)  20 bytes
            mstore(add(ptr, 0x59), amount)            // [0x59..0x79)
            mstore(add(ptr, 0x79), bridgeNonce)       // [0x79..0x99)
            mstore(add(ptr, 0x99), originChainId)     // [0x99..0xb9)
            innerHash := keccak256(ptr, 0xb9)         // hash 185 bytes
        }
        return innerHash.toEthSignedMessageHash();
    }

    /**
     * @dev Builds the mint message hash for relayer signature verification.
     *
     *  abi.encodePacked layout (195 bytes = 0xc3):
     *  ┌──────────────────┬───────┬────────┐
     *  │ Field            │ Bytes │ Offset │
     *  ├──────────────────┼───────┼────────┤
     *  │ "AETHERGATE_MINT"│  15   │ 0x00   │
     *  │ CHAIN_ID         │  32   │ 0x0f   │
     *  │ originChainId    │  32   │ 0x2f   │
     *  │ foreignAssetId   │  32   │ 0x4f   │
     *  │ recipient        │  20   │ 0x6f   │
     *  │ amount           │  32   │ 0x83   │
     *  │ bridgeNonce      │  32   │ 0xa3   │
     *  └──────────────────┴───────┴────────┘
     */
    function _buildMintHash(
        uint256 originChainId,
        bytes32 foreignAssetId,
        address recipient,
        uint256 amount,
        bytes32 bridgeNonce
    ) internal view returns (bytes32) {
        uint256 immutableChainId = CHAIN_ID;
        bytes32 innerHash;
        /// @solidity memory-safe-assembly
        assembly {
            let ptr := mload(0x40)
            //  "AETHERGATE_MINT" = 0x414554484552474154455f4d494e54
            mstore(ptr, 0x414554484552474154455f4d494e540000000000000000000000000000000000)
            mstore(add(ptr, 0x0f), immutableChainId)   // [0x0f..0x2f)
            mstore(add(ptr, 0x2f), originChainId)      // [0x2f..0x4f)
            mstore(add(ptr, 0x4f), foreignAssetId)     // [0x4f..0x6f)
            mstore(add(ptr, 0x6f), shl(96, recipient)) // [0x6f..0x83)  20 bytes
            mstore(add(ptr, 0x83), amount)             // [0x83..0xa3)
            mstore(add(ptr, 0xa3), bridgeNonce)        // [0xa3..0xc3)
            innerHash := keccak256(ptr, 0xc3)          // hash 195 bytes
        }
        return innerHash.toEthSignedMessageHash();
    }

    /// @dev Verifies that `sig` is from an address with RELAYER_ROLE.
    function _verifySignature(bytes32 msgHash, bytes calldata sig) internal view {
        address signer = msgHash.recover(sig);
        if (!hasRole(RELAYER_ROLE, signer)) revert InvalidSignature();
    }

    // ─────────────────────────────────────────
    //  View helpers
    // ─────────────────────────────────────────

    function getWrappedToken(uint256 chainId, bytes32 assetId) external view returns (address) {
        return wrappedTokens[chainId][assetId];
    }

    function isNonceProcessed(uint256 chainId, bytes32 nonce) external view returns (bool) {
        return processedNonces[chainId][nonce];
    }

    receive() external payable {
        ethVaultBalance += msg.value;
    }
}
