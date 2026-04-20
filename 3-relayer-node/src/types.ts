/**
 * AetherGate Relayer — Shared Types
 * Defines the canonical event structures used throughout the relayer pipeline.
 */

export enum BridgeDirection {
  EVM_TO_SOLANA = "EVM_TO_SOL",
  SOLANA_TO_EVM = "SOL_TO_EVM",
}

export interface BridgeEvent {
  direction:     BridgeDirection;
  bridgeNonce:   string;          // hex-encoded bytes32
  sender:        string;          // source address
  recipient:     string;          // destination address/pubkey
  assetId:       string;          // token address or mint pubkey
  amount:        bigint;
  fee:           bigint;
  srcChainId:    number;
  destChainId:   number;
  txHash:        string;          // source chain tx hash
  blockNumber:   number;
  retriesLeft:   number;
  eventType:     "LOCK" | "BURN";
}

export interface RelayerConfig {
  evmRpcUrl:             string;
  evmVaultBridgeAddress: string;
  relayerEvmPrivateKey:  string;
  solanaRpcUrl:          string;
  solanaChainId:         number;
  relayerSolanaKey:      string;
  solanaProgramId:       string;
  solanaPollIntervalMs:  number;
  evmConfirmations:      number;
  maxRetries:            number;
}
