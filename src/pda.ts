import { PublicKey, PublicKeyInitData } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { poolPda, pumpFeePda, pumpPda } from "@pump-fun/pump-swap-sdk";
import { PUMP_PROGRAM_ID } from "./sdk";
import { Buffer } from "buffer";

export const GLOBAL_PDA = pumpPda([Buffer.from("global")]);

export const PUMP_FEE_CONFIG_PDA = pumpFeePda([
  Buffer.from("fee_config"),
  PUMP_PROGRAM_ID.toBuffer(),
]);

export const GLOBAL_VOLUME_ACCUMULATOR_PDA = pumpPda([
  Buffer.from("global_volume_accumulator"),
]);

export function bondingCurvePda(mint: PublicKeyInitData): PublicKey {
  return pumpPda([
    Buffer.from("bonding-curve"),
    new PublicKey(mint).toBuffer(),
  ]);
}

export function creatorVaultPda(creator: PublicKey) {
  return pumpPda([Buffer.from("creator-vault"), creator.toBuffer()]);
}

export function pumpPoolAuthorityPda(mint: PublicKey): PublicKey {
  return pumpPda([Buffer.from("pool-authority"), mint.toBuffer()]);
}

export const CANONICAL_POOL_INDEX = 0;

export function canonicalPumpPoolPda(mint: PublicKey): PublicKey {
  return poolPda(
    CANONICAL_POOL_INDEX,
    pumpPoolAuthorityPda(mint),
    mint,
    NATIVE_MINT,
  );
}

export function userVolumeAccumulatorPda(user: PublicKey): PublicKey {
  return pumpPda([Buffer.from("user_volume_accumulator"), user.toBuffer()]);
}
