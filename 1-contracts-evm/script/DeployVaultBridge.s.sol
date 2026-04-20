// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VaultBridge} from "../src/VaultBridge.sol";

/**
 * @title DeployVaultBridge
 * @notice Foundry deployment script.
 *
 * Usage:
 *   forge script script/DeployVaultBridge.s.sol \
 *     --rpc-url $RPC_SEPOLIA \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 */
contract DeployVaultBridge is Script {
    function run() external {
        uint256 deployerPk  = vm.envUint("DEPLOYER_PK");
        address relayer     = vm.envAddress("RELAYER_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 feeBps      = vm.envUint("FEE_BPS");         // e.g. 10 = 0.10%
        uint256 chainId     = vm.envUint("BRIDGE_CHAIN_ID"); // e.g. 11155111

        address deployer = vm.addr(deployerPk);
        console2.log("Deployer :", deployer);
        console2.log("Relayer  :", relayer);
        console2.log("Fee BPS  :", feeBps);
        console2.log("Chain ID :", chainId);

        vm.startBroadcast(deployerPk);

        VaultBridge bridge = new VaultBridge(
            deployer,       // admin
            relayer,        // relayer signer
            feeRecipient,   // fee recipient
            feeBps,         // fee in bps
            chainId         // logical chain id
        );

        console2.log("VaultBridge deployed at:", address(bridge));

        vm.stopBroadcast();
    }
}
