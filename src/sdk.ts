import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { PUMP_AMM_SDK } from "@pump-fun/pump-swap-sdk";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  AccountInfo,
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import pumpIdl from "./idl/pump.json";
import { Pump } from "./idl/pump";
import BN from "bn.js";

import { bondingCurvePda, creatorVaultPda } from "./pda";
import {
  BondingCurve,
  FeeConfig,
  Global,
  GlobalVolumeAccumulator,
  UserVolumeAccumulator,
} from "./state";
import { getStaticRandomFeeRecipient } from "./bondingCurve";
import { OFFLINE_PUMP_PROGRAM } from "./onlineSdk";

export function getPumpProgram(connection: Connection): Program<Pump> {
  return new Program(
    pumpIdl as Pump,
    new AnchorProvider(connection, null as any, {}),
  );
}

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

export const PUMP_AMM_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
);

export const PUMP_FEE_PROGRAM_ID = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
);

export const BONDING_CURVE_NEW_SIZE = 150;

export const PUMP_TOKEN_MINT = new PublicKey(
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
);

export class PumpSdk {
  private readonly offlinePumpProgram: Program<Pump>;

  constructor() {
    this.offlinePumpProgram = OFFLINE_PUMP_PROGRAM;
  }

  decodeGlobal(accountInfo: AccountInfo<Buffer>): Global {
    return this.offlinePumpProgram.coder.accounts.decode<Global>(
      "global",
      accountInfo.data,
    );
  }

  decodeFeeConfig(accountInfo: AccountInfo<Buffer>): FeeConfig {
    return this.offlinePumpProgram.coder.accounts.decode<FeeConfig>(
      "feeConfig",
      accountInfo.data,
    );
  }

  decodeBondingCurve(accountInfo: AccountInfo<Buffer>): BondingCurve {
    return this.offlinePumpProgram.coder.accounts.decode<BondingCurve>(
      "bondingCurve",
      accountInfo.data,
    );
  }

  decodeBondingCurveNullable(
    accountInfo: AccountInfo<Buffer>,
  ): BondingCurve | null {
    try {
      return this.decodeBondingCurve(accountInfo);
    } catch (e) {
      console.warn("Failed to decode bonding curve", e);
      return null;
    }
  }

  decodeGlobalVolumeAccumulator(
    accountInfo: AccountInfo<Buffer>,
  ): GlobalVolumeAccumulator {
    return this.offlinePumpProgram.coder.accounts.decode<GlobalVolumeAccumulator>(
      "globalVolumeAccumulator",
      accountInfo.data,
    );
  }

  decodeUserVolumeAccumulator(
    accountInfo: AccountInfo<Buffer>,
  ): UserVolumeAccumulator {
    return this.offlinePumpProgram.coder.accounts.decode<UserVolumeAccumulator>(
      "userVolumeAccumulator",
      accountInfo.data,
    );
  }

  decodeUserVolumeAccumulatorNullable(
    accountInfo: AccountInfo<Buffer>,
  ): UserVolumeAccumulator | null {
    try {
      return this.decodeUserVolumeAccumulator(accountInfo);
    } catch (e) {
      console.warn("Failed to decode user volume accumulator", e);
      return null;
    }
  }

  async createInstruction({
    mint,
    name,
    symbol,
    uri,
    creator,
    user,
  }: {
    mint: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    creator: PublicKey;
    user: PublicKey;
  }): Promise<TransactionInstruction> {
    return await this.offlinePumpProgram.methods
      .create(name, symbol, uri, creator)
      .accountsPartial({
        mint,
        user,
      })
      .instruction();
  }

  async buyInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    associatedUserAccountInfo,
    mint,
    user,
    amount,
    solAmount,
    slippage,
  }: {
    global: Global;
    bondingCurveAccountInfo: AccountInfo<Buffer>;
    bondingCurve: BondingCurve;
    associatedUserAccountInfo: AccountInfo<Buffer> | null;
    mint: PublicKey;
    user: PublicKey;
    amount: BN;
    solAmount: BN;
    slippage: number;
  }): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];

    if (bondingCurveAccountInfo.data.length < BONDING_CURVE_NEW_SIZE) {
      instructions.push(
        await this.extendAccountInstruction({
          account: bondingCurvePda(mint),
          user,
        }),
      );
    }

    const associatedUser = getAssociatedTokenAddressSync(mint, user, true);

    if (!associatedUserAccountInfo) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          user,
          associatedUser,
          user,
          mint,
        ),
      );
    }

    instructions.push(
      await this.buyInstruction({
        global,
        mint,
        creator: bondingCurve.creator,
        user,
        associatedUser,
        amount,
        solAmount,
        slippage,
      }),
    );

    return instructions;
  }

  async createAndBuyInstructions({
    global,
    mint,
    name,
    symbol,
    uri,
    creator,
    user,
    amount,
    solAmount,
  }: {
    global: Global;
    mint: PublicKey;
    name: string;
    symbol: string;
    uri: string;
    creator: PublicKey;
    user: PublicKey;
    amount: BN;
    solAmount: BN;
  }): Promise<TransactionInstruction[]> {
    const associatedUser = getAssociatedTokenAddressSync(mint, user, true);
    return [
      await this.createInstruction({ mint, name, symbol, uri, creator, user }),
      await this.extendAccountInstruction({
        account: bondingCurvePda(mint),
        user,
      }),
      createAssociatedTokenAccountIdempotentInstruction(
        user,
        associatedUser,
        user,
        mint,
      ),
      await this.buyInstruction({
        global,
        mint,
        creator,
        user,
        associatedUser,
        amount,
        solAmount,
        slippage: 1,
      }),
    ];
  }

  private async buyInstruction({
    global,
    mint,
    creator,
    user,
    associatedUser,
    amount,
    solAmount,
    slippage,
  }: {
    global: Global;
    mint: PublicKey;
    creator: PublicKey;
    user: PublicKey;
    associatedUser: PublicKey;
    amount: BN;
    solAmount: BN;
    slippage: number;
  }) {
    return await this.getBuyInstructionInternal({
      user,
      associatedUser,
      mint,
      creator,
      feeRecipient: getFeeRecipient(global),
      amount,
      solAmount: solAmount.add(
        solAmount.mul(new BN(Math.floor(slippage * 10))).div(new BN(1000)),
      ),
    });
  }

  async sellInstructions({
    global,
    bondingCurveAccountInfo,
    bondingCurve,
    mint,
    user,
    amount,
    solAmount,
    slippage,
  }: {
    global: Global;
    bondingCurveAccountInfo: AccountInfo<Buffer>;
    bondingCurve: BondingCurve;
    mint: PublicKey;
    user: PublicKey;
    amount: BN;
    solAmount: BN;
    slippage: number;
  }): Promise<TransactionInstruction[]> {
    const instructions: TransactionInstruction[] = [];

    if (bondingCurveAccountInfo.data.length < BONDING_CURVE_NEW_SIZE) {
      instructions.push(
        await this.extendAccountInstruction({
          account: bondingCurvePda(mint),
          user,
        }),
      );
    }

    instructions.push(
      await this.getSellInstructionInternal({
        user,
        mint,
        creator: bondingCurve.creator,
        feeRecipient: getFeeRecipient(global),
        amount,
        solAmount: solAmount.sub(
          solAmount.mul(new BN(Math.floor(slippage * 10))).div(new BN(1000)),
        ),
      }),
    );

    return instructions;
  }

  async extendAccountInstruction({
    account,
    user,
  }: {
    account: PublicKey;
    user: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.offlinePumpProgram.methods
      .extendAccount()
      .accountsPartial({
        account,
        user,
      })
      .instruction();
  }

  async migrateInstruction({
    withdrawAuthority,
    mint,
    user,
  }: {
    withdrawAuthority: PublicKey;
    mint: PublicKey;
    user: PublicKey;
  }): Promise<TransactionInstruction> {
    return this.offlinePumpProgram.methods
      .migrate()
      .accountsPartial({
        mint,
        user,
        withdrawAuthority,
      })
      .instruction();
  }

  async syncUserVolumeAccumulator(
    user: PublicKey,
  ): Promise<TransactionInstruction> {
    return await this.offlinePumpProgram.methods
      .syncUserVolumeAccumulator()
      .accountsPartial({ user })
      .instruction();
  }

  async syncUserVolumeAccumulatorBothPrograms(
    user: PublicKey,
  ): Promise<TransactionInstruction[]> {
    return [
      await this.syncUserVolumeAccumulator(user),
      await PUMP_AMM_SDK.syncUserVolumeAccumulator(user),
    ];
  }

  async setCreator({
    mint,
    setCreatorAuthority,
    creator,
  }: {
    mint: PublicKey;
    setCreatorAuthority: PublicKey;
    creator: PublicKey;
  }): Promise<TransactionInstruction> {
    return await this.offlinePumpProgram.methods
      .setCreator(creator)
      .accountsPartial({
        mint,
        setCreatorAuthority,
      })
      .instruction();
  }

  async initUserVolumeAccumulator({
    payer,
    user,
  }: {
    payer: PublicKey;
    user: PublicKey;
  }): Promise<TransactionInstruction> {
    return await this.offlinePumpProgram.methods
      .initUserVolumeAccumulator()
      .accountsPartial({ payer, user })
      .instruction();
  }

  async closeUserVolumeAccumulator(
    user: PublicKey,
  ): Promise<TransactionInstruction> {
    return await this.offlinePumpProgram.methods
      .closeUserVolumeAccumulator()
      .accountsPartial({ user })
      .instruction();
  }

  async getBuyInstructionRaw({
    user,
    mint,
    creator,
    amount,
    solAmount,
    feeRecipient = getStaticRandomFeeRecipient(),
  }: {
    user: PublicKey;
    mint: PublicKey;
    creator: PublicKey;
    amount: BN;
    solAmount: BN;
    feeRecipient: PublicKey;
  }): Promise<TransactionInstruction> {
    return await this.getBuyInstructionInternal({
      user,
      associatedUser: getAssociatedTokenAddressSync(mint, user, true),
      mint,
      creator,
      feeRecipient,
      amount,
      solAmount,
    });
  }

  private async getBuyInstructionInternal({
    user,
    associatedUser,
    mint,
    creator,
    feeRecipient,
    amount,
    solAmount,
  }: {
    user: PublicKey;
    associatedUser: PublicKey;
    mint: PublicKey;
    creator: PublicKey;
    feeRecipient: PublicKey;
    amount: BN;
    solAmount: BN;
  }): Promise<TransactionInstruction> {
    return await this.offlinePumpProgram.methods
      .buy(amount, solAmount, { 0: true })
      .accountsPartial({
        feeRecipient,
        mint,
        associatedUser,
        user,
        creatorVault: creatorVaultPda(creator),
      })
      .instruction();
  }

  async getSellInstructionRaw({
    user,
    mint,
    creator,
    amount,
    solAmount,
    feeRecipient = getStaticRandomFeeRecipient(),
  }: {
    user: PublicKey;
    mint: PublicKey;
    creator: PublicKey;
    amount: BN;
    solAmount: BN;
    feeRecipient: PublicKey;
  }): Promise<TransactionInstruction> {
    return await this.getSellInstructionInternal({
      user,
      mint,
      creator,
      feeRecipient,
      amount,
      solAmount,
    });
  }

  private async getSellInstructionInternal({
    user,
    mint,
    creator,
    feeRecipient,
    amount,
    solAmount,
  }: {
    user: PublicKey;
    mint: PublicKey;
    creator: PublicKey;
    feeRecipient: PublicKey;
    amount: BN;
    solAmount: BN;
  }): Promise<TransactionInstruction> {
    return await this.offlinePumpProgram.methods
      .sell(amount, solAmount)
      .accountsPartial({
        feeRecipient,
        mint,
        associatedUser: getAssociatedTokenAddressSync(mint, user, true),
        user,
        creatorVault: creatorVaultPda(creator),
      })
      .instruction();
  }
}

export const PUMP_SDK = new PumpSdk();

export function getFeeRecipient(global: Global): PublicKey {
  const feeRecipients = [global.feeRecipient, ...global.feeRecipients];
  return feeRecipients[Math.floor(Math.random() * feeRecipients.length)];
}
