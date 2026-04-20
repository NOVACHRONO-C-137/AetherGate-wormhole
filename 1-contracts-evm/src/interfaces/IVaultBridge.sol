// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IVaultBridge — AetherGate EVM Bridge Interface
interface IVaultBridge {
    // ─── Events ──────────────────────────────────────────────────────────────
    event Locked(
        address indexed sender,
        address indexed token,
        uint256 amount,
        uint256 fee,
        uint256 destChainId,
        bytes32 destRecipient,
        bytes32 indexed bridgeNonce
    );

    event Unlocked(
        bytes32 indexed bridgeNonce,
        address indexed recipient,
        address indexed token,
        uint256 amount
    );

    event WrappedMinted(
        bytes32 indexed bridgeNonce,
        address indexed recipient,
        address indexed wrappedToken,
        uint256 amount,
        uint256 originChainId
    );

    event Burned(
        address indexed sender,
        address indexed wrappedToken,
        uint256 amount,
        uint256 fee,
        uint256 destChainId,
        bytes32 destRecipient,
        bytes32 indexed bridgeNonce
    );

    // ─── Errors ───────────────────────────────────────────────────────────────
    error UnsupportedToken(address token);
    error AmountZero();
    error InvalidSignature();
    error NonceAlreadyProcessed(bytes32 nonce);
    error WrappedTokenNotFound(uint256 chainId, bytes32 assetId);
    error WrappedTokenAlreadyExists(uint256 chainId, bytes32 assetId);
    error EthTransferFailed();
    error InvalidFee();

    // ─── State-mutating ───────────────────────────────────────────────────────
    function lockNative(
        address token,
        uint256 amount,
        uint256 destChainId,
        bytes32 destRecipient
    ) external;

    function lockNativeETH(uint256 destChainId, bytes32 destRecipient) external payable;

    function unlockNative(
        address token,
        address recipient,
        uint256 amount,
        bytes32 bridgeNonce,
        uint256 originChainId,
        bytes calldata sig
    ) external;

    function mintWrapped(
        uint256 originChainId,
        bytes32 foreignAssetId,
        address recipient,
        uint256 amount,
        bytes32 bridgeNonce,
        bytes calldata sig
    ) external;

    function burnWrapped(
        uint256 originChainId,
        bytes32 foreignAssetId,
        uint256 amount,
        uint256 destChainId,
        bytes32 destRecipient
    ) external;

    // ─── View ─────────────────────────────────────────────────────────────────
    function getWrappedToken(uint256 chainId, bytes32 assetId) external view returns (address);
    function isNonceProcessed(uint256 chainId, bytes32 nonce) external view returns (bool);
    function CHAIN_ID() external view returns (uint256);
    function feeBps() external view returns (uint256);
    function feeRecipient() external view returns (address);
}
