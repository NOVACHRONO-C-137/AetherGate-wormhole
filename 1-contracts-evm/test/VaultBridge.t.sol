// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {VaultBridge, WrappedToken} from "../src/VaultBridge.sol";
import {ERC20Mock} from "@openzeppelin/contracts/mocks/token/ERC20Mock.sol";

contract VaultBridgeTest is Test {
    VaultBridge public bridge;
    ERC20Mock   public token;

    address constant ADMIN     = address(0xA0);
    address constant RELAYER   = address(0xBE);
    address constant FEE_ADDR  = address(0xFE);
    address constant USER      = address(0xCC);

    uint256 constant CHAIN_ID  = 11155111; // Sepolia
    uint256 constant SOL_CHAIN = 101;      // Solana Devnet
    uint256 constant FEE_BPS   = 10;       // 0.10%

    uint256 relayerKey;
    address relayerSigner;

    // ─── Setup ────────────────────────────────────────────────────────────────

    function setUp() public {
        relayerKey    = 0xBEEFCAFE;
        relayerSigner = vm.addr(relayerKey);

        vm.startPrank(ADMIN);
        bridge = new VaultBridge(ADMIN, relayerSigner, FEE_ADDR, FEE_BPS, CHAIN_ID);
        token  = new ERC20Mock();
        bridge.setSupportedToken(address(token), true);
        bridge.setSupportedToken(address(0), true); // ETH
        vm.stopPrank();

        // Fund user
        token.mint(USER, 1_000e18);
        vm.deal(USER, 100 ether);
    }

    // ─── lockNative (ERC-20) ──────────────────────────────────────────────────

    function test_lockNative_ERC20_emitsLocked() public {
        bytes32 dest = bytes32(uint256(uint160(address(0xSOL))));

        vm.startPrank(USER);
        token.approve(address(bridge), 100e18);

        vm.expectEmit(true, true, false, false);
        emit VaultBridge.Locked(USER, address(token), 0, 0, SOL_CHAIN, dest, bytes32(0));

        bridge.lockNative(address(token), 100e18, SOL_CHAIN, dest);
        vm.stopPrank();
    }

    function test_lockNative_feeDeducted() public {
        bytes32 dest = bytes32(uint256(1));
        uint256 amount = 1000e18;

        vm.startPrank(USER);
        token.approve(address(bridge), amount);
        bridge.lockNative(address(token), amount, SOL_CHAIN, dest);
        vm.stopPrank();

        uint256 expectedFee = (amount * FEE_BPS) / 10_000; // 1e18
        assertEq(token.balanceOf(FEE_ADDR), expectedFee);
    }

    function test_lockNative_revertsUnsupportedToken() public {
        address badToken = address(0xDEAD);
        vm.prank(USER);
        vm.expectRevert(abi.encodeWithSelector(VaultBridge.UnsupportedToken.selector, badToken));
        bridge.lockNative(badToken, 1e18, SOL_CHAIN, bytes32(0));
    }

    function test_lockNative_revertsZeroAmount() public {
        vm.prank(USER);
        vm.expectRevert(VaultBridge.AmountZero.selector);
        bridge.lockNative(address(token), 0, SOL_CHAIN, bytes32(0));
    }

    // ─── lockNativeETH ────────────────────────────────────────────────────────

    function test_lockNativeETH_emitsLocked() public {
        bytes32 dest = bytes32(uint256(42));
        vm.prank(USER);
        vm.expectEmit(true, true, false, false);
        emit VaultBridge.Locked(USER, address(0), 0, 0, SOL_CHAIN, dest, bytes32(0));
        bridge.lockNativeETH{value: 1 ether}(SOL_CHAIN, dest);
    }

    // ─── mintWrapped ──────────────────────────────────────────────────────────

    function test_mintWrapped_success() public {
        bytes32 foreignAsset = keccak256("SOL_USDC");

        vm.prank(ADMIN);
        address wtAddr = bridge.deployWrappedToken(SOL_CHAIN, foreignAsset, "Wrapped USDC", "wUSDC", 6);

        bytes32 bridgeNonce = keccak256("nonce1");
        uint256 amount = 500e6;

        // Build signature
        bytes32 msgHash = keccak256(
            abi.encodePacked(
                "AETHERGATE_MINT",
                uint256(CHAIN_ID),
                uint256(SOL_CHAIN),
                foreignAsset,
                USER,
                amount,
                bridgeNonce
            )
        );
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(relayerKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(relayerSigner);
        bridge.mintWrapped(SOL_CHAIN, foreignAsset, USER, amount, bridgeNonce, sig);

        assertEq(WrappedToken(wtAddr).balanceOf(USER), amount);
    }

    function test_mintWrapped_revertsReplay() public {
        bytes32 foreignAsset = keccak256("SOL_USDC");
        vm.prank(ADMIN);
        bridge.deployWrappedToken(SOL_CHAIN, foreignAsset, "Wrapped USDC", "wUSDC", 6);

        bytes32 bridgeNonce = keccak256("nonce_replay");
        uint256 amount = 100e6;

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                "AETHERGATE_MINT",
                uint256(CHAIN_ID),
                uint256(SOL_CHAIN),
                foreignAsset,
                USER,
                amount,
                bridgeNonce
            )
        );
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(relayerKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.startPrank(relayerSigner);
        bridge.mintWrapped(SOL_CHAIN, foreignAsset, USER, amount, bridgeNonce, sig);

        vm.expectRevert(abi.encodeWithSelector(VaultBridge.NonceAlreadyProcessed.selector, bridgeNonce));
        bridge.mintWrapped(SOL_CHAIN, foreignAsset, USER, amount, bridgeNonce, sig);
        vm.stopPrank();
    }

    // ─── burnWrapped ──────────────────────────────────────────────────────────

    function test_burnWrapped_emitsBurned() public {
        bytes32 foreignAsset = keccak256("SOL_SOL");

        vm.prank(ADMIN);
        bridge.deployWrappedToken(SOL_CHAIN, foreignAsset, "Wrapped SOL", "wSOL", 9);

        // First mint some
        bytes32 bridgeNonce = keccak256("mint_nonce");
        uint256 amount = 1e9;

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                "AETHERGATE_MINT",
                uint256(CHAIN_ID),
                uint256(SOL_CHAIN),
                foreignAsset,
                USER,
                amount,
                bridgeNonce
            )
        );
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(relayerKey, ethHash);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(relayerSigner);
        bridge.mintWrapped(SOL_CHAIN, foreignAsset, USER, amount, bridgeNonce, sig);

        // Now burn
        bytes32 destRecipient = bytes32(uint256(99));
        vm.prank(USER);
        vm.expectEmit(true, true, false, false);
        address wtAddr = bridge.getWrappedToken(SOL_CHAIN, foreignAsset);
        emit VaultBridge.Burned(USER, wtAddr, 0, 0, SOL_CHAIN, destRecipient, bytes32(0));
        bridge.burnWrapped(SOL_CHAIN, foreignAsset, amount, SOL_CHAIN, destRecipient);
    }

    // ─── Fuzz ─────────────────────────────────────────────────────────────────

    function testFuzz_lockAndFee(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e18);
        token.mint(USER, amount);

        bytes32 dest = bytes32(uint256(1));
        vm.startPrank(USER);
        token.approve(address(bridge), amount);
        bridge.lockNative(address(token), amount, SOL_CHAIN, dest);
        vm.stopPrank();

        uint256 expectedFee = (amount * FEE_BPS) / 10_000;
        assertEq(token.balanceOf(FEE_ADDR), expectedFee);
    }
}
