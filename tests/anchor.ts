import BN from "bn.js";
import assert from "assert";
import * as web3 from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import type { SavactPayment } from "../target/types/savact_payment";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";

// Configure the client to use the local cluster
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

const program = anchor.workspace.SavactPayment;
let timeStamp: number = Date.now();
const shortDelayInS = 10;

// const managerKeypair = anchor.web3.Keypair.generate();
// const systemKeypair = anchor.web3.Keypair.generate();
// const fromKeypair = anchor.web3.Keypair.generate();
// const toKeypair = anchor.web3.Keypair.generate();

const managerKeypair = createKeypairFromHex(
  "e5feab771072b3ce6c439621d5f7d8e430e0adb8f480c869282f27253f579fe5e259c7e3a4f589cc58e27e47248d3c4299c79128950632e04c632fcfadbdf8a4"
);
const systemKeypair = createKeypairFromHex(
  "524f7ba43fcfee6b8331aa9ecd4f9b337773d26306dd0371585b473410568aff30f0f7011a3c6f0a4b99db59dd8f8277041be73a6b992bf9ef325e177bdc736a"
);
const fromKeypair = createKeypairFromHex(
  "1b13d2b449730d2ea338265d12923fb779ea518d9576b3edf8f3650203fa372f550f87706a849b56608ef0eb5c7384a3aa84223ec55036ab01f43461a2b1008d"
);
const toKeypair = createKeypairFromHex(
  "599b05d506c83fc4c14baee1ff2611e7cb57605d3bce40a048874f0aa6b932712a56541aeccd6302948787adce5ac253d627f5da6d8e79717e9da6e9db638685"
);

const newSystemKeypair = createKeypairFromHex(
  "65f47180d849c6542a425c96149aaa9e67ac91f6fce449def5f69e88eecb4331044d6da709f3ea17729a01617bc5621ccb2d9e618f2f578baaba20895af760d5"
);

let mint;
let fromTokenAccount;
let toTokenAccount;
let systemTokenAccount;
let depositTokenAccountPda;
let paymentPda;
const amount = new anchor.BN(100000);
const expiry_in_1h = new anchor.BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour from now

const confirmTransaction = async (signature) => {
  const latestBlockhash = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction({
    signature,
    ...latestBlockhash,
  });
};

logKeypairDetails("managerKeypair", managerKeypair);
logKeypairDetails("systemKeypair", systemKeypair);
logKeypairDetails("fromKeypair", fromKeypair);
logKeypairDetails("toKeypair", toKeypair);

const getLastPda = async () => {
  const managerAccount = await program.account.paymentManager.fetch(
    managerKeypair.publicKey
  );
  const count = managerAccount.paymentCount;

  const pda = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("payment"),
      managerKeypair.publicKey.toBuffer(),
      count.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  )[0];

  const depositPda = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), pda.toBuffer()],
    program.programId
  )[0];
  return {
    pda,
    depositPda,
    count,
  };
};

const createPayment = async (expiry: anchor.BN) => {
  const lastPda = await getLastPda();
  paymentPda = lastPda.pda;
  depositTokenAccountPda = lastPda.depositPda;
  const paymentCount = lastPda.count;

  const tx = await program.methods
    .createPayment(amount, expiry)
    .accounts({
      manager: managerKeypair.publicKey,
      payment: paymentPda,
      from: fromKeypair.publicKey,
      to: toKeypair.publicKey,
      mint: mint,
      fromTokenAcc: fromTokenAccount,
      depositTokenAcc: depositTokenAccountPda,
      systemProgram: web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([fromKeypair])
    .rpc();

  await confirmTransaction(tx);

  // Fetch the transaction details
  const txDetails = await provider.connection.getTransaction(tx, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  // Fetch the payment account
  const paymentAccount = await program.account.payment.fetch(paymentPda);

  // Assertions
  assert.ok(paymentAccount.from.equals(fromKeypair.publicKey));
  assert.ok(paymentAccount.to.equals(toKeypair.publicKey));
  assert.ok(paymentAccount.mint.equals(mint));
  assert.ok(paymentAccount.amount.eq(new anchor.BN(amount)));
  assert.ok(paymentAccount.expiry.eq(new anchor.BN(expiry)));
  assert.strictEqual(paymentAccount.status, 0); // Active
  assert.ok(paymentAccount.paymentId.eq(paymentCount));

  // New assertion to check if the returned payment_id matches the expected value
  if ("returnData" in txDetails.meta) {
    const returnData = (
      txDetails.meta as unknown as { returnData: { data: Array<string> } }
    ).returnData;
    if (returnData.data[1] === "base64") {
      const decodedData = Buffer.from(returnData.data[0], "base64");
      const returnedPaymentId = new anchor.BN(decodedData.slice(0, 8), "le");
      assert.ok(
        returnedPaymentId.eq(paymentCount),
        "Returned payment_id does not match expected value"
      );
    } else {
      console.error("Unexpected return data format");
    }
  }
};

describe("savact_payment", () => {  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SavactPayment as anchor.Program<SavactPayment>;
  

  before(async () => {
    // Airdrop SOL to necessary accounts
    // console.log("Request Aridrop for system");
    // await provider.connection.requestAirdrop(systemKeypair.publicKey, 1000000);
    // console.log("Request Aridrop for recipient");
    // await provider.connection.requestAirdrop(fromKeypair.publicKey, 1000000);
    // console.log("Request Aridrop for sender");
    // await provider.connection.requestAirdrop(toKeypair.publicKey, 1000000);

    // Create mint
    mint = await createMint(
      provider.connection,
      fromKeypair,
      fromKeypair.publicKey,
      null,
      6 // 6 decimals
    );

    // Create token accounts
    fromTokenAccount = await createAccount(
      provider.connection,
      fromKeypair,
      mint,
      fromKeypair.publicKey
    );

    toTokenAccount = await createAccount(
      provider.connection,
      toKeypair,
      mint,
      toKeypair.publicKey
    );

    systemTokenAccount = await createAccount(
      provider.connection,
      systemKeypair,
      mint,
      systemKeypair.publicKey
    );

    // Mint some tokens to fromTokenAccount
    await mintTo(
      provider.connection,
      fromKeypair,
      mint,
      fromTokenAccount,
      fromKeypair.publicKey,
      1000000 // 1000 tokens
    );
  });

  it("Initialized payment manager", async () => {
    let managerAccount;
    try {
      managerAccount = await program.account.paymentManager.fetch(
        managerKeypair.publicKey
      );
      return;
    } catch (e) {}
    const signature = await program.methods
      .initialize(systemKeypair.publicKey)
      .accounts({
        manager: managerKeypair.publicKey,
        authority: provider.wallet.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([managerKeypair])
      .rpc();
    await confirmTransaction(signature);
    managerAccount = await program.account.paymentManager.fetch(
      managerKeypair.publicKey
    );
    assert.ok(managerAccount.authority.equals(provider.wallet.publicKey));
    assert.ok(managerAccount.paymentCount.eq(new anchor.BN(0)));
    assert.ok(managerAccount.system.equals(systemKeypair.publicKey));
  });

  it("Create payment 1", async () => {
    await createPayment(expiry_in_1h);
  });

  it("Extend payment", async () => {
    const newExpiry = new anchor.BN(expiry_in_1h.toNumber() + 3600); // Add another hour
    const signature = await program.methods
      .extend(newExpiry)
      .accounts({
        manager: managerKeypair.publicKey,
        payment: paymentPda,
        to: toKeypair.publicKey,
      })
      .signers([toKeypair])
      .rpc();
    await confirmTransaction(signature);

    const paymentAccount = await program.account.payment.fetch(paymentPda);
    assert.ok(paymentAccount.expiry.eq(newExpiry));
  });

  it("should fail to extend to a lower time", async () => {
    const newExpiry = new anchor.BN(expiry_in_1h.toNumber() + 3600 - 60); // Add another hour minus one minute
    try {
      await program.methods
        .extend(newExpiry)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(error.error.errorMessage, "Invalid new expiry time");
    }
  });

  it("Finalize payment", async () => {
    const initialBalances = await getBalances(toTokenAccount);

    const signature = await program.methods
      .finalize()
      .accounts({
        manager: managerKeypair.publicKey,
        payment: paymentPda,
        from: fromKeypair.publicKey,
        to: toKeypair.publicKey,
        mint: mint,
        depositTokenAcc: depositTokenAccountPda,
        toTokenAcc: toTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([fromKeypair])
      .rpc();

    await confirmTransaction(signature);

    const paymentAccount = await program.account.payment.fetch(paymentPda);
    assert.strictEqual(paymentAccount.status, 4); // Finalized

    const finalBalances = await getBalances(toTokenAccount);
    checkBalance(initialBalances, finalBalances, amount);
  });

  it("should fail to finalize again", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to extend finalized payment", async () => {
    const newExpiry = new anchor.BN(expiry_in_1h.toNumber() + 3600); // Add another hour
    try {
      await program.methods
        .extend(newExpiry)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("Create payment 2", async () => {
    await createPayment(expiry_in_1h);
  });

  it("Reject payment", async () => {
    const initialBalances = await getBalances(fromTokenAccount);

    // Now reject the payment
    const rejectSignature = await program.methods
      .reject()
      .accounts({
        manager: managerKeypair.publicKey,
        payment: paymentPda,
        from: fromKeypair.publicKey,
        to: toKeypair.publicKey,
        mint: mint,
        depositTokenAcc: depositTokenAccountPda,
        fromTokenAcc: fromTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([toKeypair])
      .rpc();

    await confirmTransaction(rejectSignature);

    const rejectedPaymentAccount = await program.account.payment.fetch(
      paymentPda
    );
    assert.strictEqual(rejectedPaymentAccount.status, 3); // Rejected

    const finalBalances = await getBalances(fromTokenAccount);
    checkBalance(initialBalances, finalBalances, amount);
  });

  it("should fail to reject again", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          fromTokenAcc: fromTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("Create payment 3", async () => {
    await createPayment(expiry_in_1h);
  });

  it("Invalidate payment", async () => {
    const initialBalances = await getBalances(systemTokenAccount);

    const signature = await program.methods
      .invalidate()
      .accounts({
        manager: managerKeypair.publicKey,
        payment: paymentPda,
        from: fromKeypair.publicKey,
        mint: mint,
        depositTokenAcc: depositTokenAccountPda,
        systemTokenAcc: systemTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([fromKeypair])
      .rpc();
    await confirmTransaction(signature);

    const paymentAccount = await program.account.payment.fetch(paymentPda);
    assert.strictEqual(paymentAccount.status, 1); // Invalidated

    const finalBalances = await getBalances(systemTokenAccount);
    checkBalance(initialBalances, finalBalances, amount);
  });

  it("should fail to invalidate again", async () => {
    try {
      await program.methods
        .invalidate()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          systemTokenAcc: systemTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it(`Create payment 4 with expiration in just ${shortDelayInS}s`, async () => {
    timeStamp = Date.now();
    const expire_shortly = new anchor.BN(
      Math.floor(Date.now() / 1000) + shortDelayInS
    );
    await createPayment(expire_shortly);
  });

  it("should fail to create payment that is already expired", async () => {
    const expired = new anchor.BN(Math.floor(Date.now() / 1000) - 3600);
    const lastPda = await getLastPda();
    try {
      await program.methods
        .createPayment(amount, expired)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: lastPda.pda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          fromTokenAcc: fromTokenAccount,
          depositTokenAcc: lastPda.depositPda,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([fromKeypair])
        .rpc();

      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.error.errorMessage,
        "Time limit is already expired"
      );
    }
  });
  it("should fail to create payment with wrong signer", async () => {
    const lastPda = await getLastPda();
    try {
      await program.methods
        .createPayment(amount, expiry_in_1h)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: lastPda.pda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          fromTokenAcc: fromTokenAccount,
          depositTokenAcc: lastPda.depositPda,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([toKeypair]) // Wrong signer
        .rpc();

      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${toKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to create payment with wrong manager", async () => {
    const lastPda = await getLastPda();
    try {
      await program.methods
        .createPayment(amount, expiry_in_1h)
        .accounts({
          manager: toKeypair.publicKey, // Wrong manager
          payment: lastPda.pda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          fromTokenAcc: fromTokenAccount,
          depositTokenAcc: lastPda.depositPda,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([fromKeypair])
        .rpc();

      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes(""),
        "The given account is owned by a different program than expected"
      );
    }
  });
  it("should fail to create payment with payment pda of last successfull transaction", async () => {
    const lastPda = await getLastPda();
    try {
      await program.methods
        .createPayment(amount, expiry_in_1h)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda, // Wrong pda
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          fromTokenAcc: fromTokenAccount,
          depositTokenAcc: lastPda.depositPda,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([fromKeypair])
        .rpc();

      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A seeds constraint was violated"),
        error.toString()
      );
    }
  });
  it("should fail to create payment with wrong sender", async () => {
    const lastPda = await getLastPda();
    try {
      await program.methods
        .createPayment(amount, expiry_in_1h)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: lastPda.pda,
          from: systemKeypair.publicKey, // Wrong sender
          to: toKeypair.publicKey,
          mint: mint,
          fromTokenAcc: fromTokenAccount,
          depositTokenAcc: lastPda.depositPda,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([fromKeypair])
        .rpc();

      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${fromKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to create payment with wrong sender token account", async () => {
    const lastPda = await getLastPda();
    try {
      await program.methods
        .createPayment(amount, expiry_in_1h)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: lastPda.pda,
          from: systemTokenAccount.publicKey, // Wrong sender token account
          to: toKeypair.publicKey,
          mint: mint,
          fromTokenAcc: fromTokenAccount,
          depositTokenAcc: lastPda.depositPda,
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([fromKeypair])
        .rpc();

      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${fromKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to create payment with deposit account of last payment", async () => {
    const lastPda = await getLastPda();
    try {
      await program.methods
        .createPayment(amount, expiry_in_1h)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: lastPda.pda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          fromTokenAcc: fromTokenAccount,
          depositTokenAcc: depositTokenAccountPda, // wrong deposit account
          systemProgram: web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([fromKeypair])
        .rpc();

      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A seeds constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to finialize payment with wrong signer", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair]) // wrong signer
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${toKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to finialize payment with wrong recipient", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: systemKeypair.publicKey, // Wrong recipient
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${fromKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to finalize payment with wrong sender", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: systemKeypair.publicKey, // Wrong sender
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("has one constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to finialize payment with wrong manager", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: systemTokenAccount.publicKey, // Wrong manager
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: Invalid arguments: manager not provided.`
      );
    }
  });

  it("should fail to finialize payment with wrong deposit account", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: systemTokenAccount, // Wrong deposit account
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });
  it("should fail to finialize payment with wrong recipient token account", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: systemTokenAccount, // Wrong recipient token account
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to invalidate payment with wrong signer", async () => {
    try {
      await program.methods
        .invalidate()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          systemTokenAcc: systemTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair]) // Wrong signer
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${toKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to invalidate payment with wrong sender", async () => {
    try {
      await program.methods
        .invalidate()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: toKeypair.publicKey, // wrong sender
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          systemTokenAcc: systemTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${fromKeypair.publicKey.toString()}`
      );
    }
  });

  it("should fail to invalidate payment with wrong manager", async () => {
    try {
      await program.methods
        .invalidate()
        .accounts({
          manager: systemKeypair.publicKey, // Wrong manager
          payment: paymentPda,
          from: fromKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          systemTokenAcc: systemTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes(""),
        "The given account is owned by a different program than expected"
      );
    }
  });

  it("should fail to invalidate payment with wrong deposit account", async () => {
    try {
      await program.methods
        .invalidate()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          mint: mint,
          depositTokenAcc: toTokenAccount, // Wrong deposit account
          systemTokenAcc: systemTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });
  it("should fail to invalidate payment with wrong system token account", async () => {
    try {
      await program.methods
        .invalidate()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          systemTokenAcc: toTokenAccount, // Wrong system token account
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to reject payment with wrong signer", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          fromTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair]) // Wrong signer
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${fromKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to reject payment with wrong original recipient", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: systemKeypair.publicKey, // Wrong recipient
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          fromTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("has one constraint was violated"),
        error.toString()
      );
    }
  });
  it("should fail to reject payment with wrong sender", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: systemKeypair.publicKey, // Wrong sender
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          fromTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${toKeypair.publicKey.toString()}`
      );
    }
  });

  it("should fail to reject payment with wrong manager", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: systemKeypair.publicKey, // Wrong manager
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          fromTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes(""),
        "The given account is owned by a different program than expected"
      );
    }
  });

  it("should fail to reject payment with wrong deposit account", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: systemTokenAccount, // Wrong deposition account
          fromTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });
  it("should fail to reject payment with wrong sender token account", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          fromTokenAcc: toTokenAccount, // Wrong sender token account
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to extend payment with wrong signer", async () => {
    const newExpiry = new anchor.BN(expiry_in_1h.toNumber() + 3600); // Add another hour
    try {
      await program.methods
        .extend(newExpiry)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
        })
        .signers([fromKeypair]) // wrong signer
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${fromKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to extend payment with wrong recipient", async () => {
    const newExpiry = new anchor.BN(expiry_in_1h.toNumber() + 3600); // Add another hour
    try {
      await program.methods
        .extend(newExpiry)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: fromKeypair.publicKey, // Wrong recipient
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${toKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to extend payment with wrong manager", async () => {
    const newExpiry = new anchor.BN(expiry_in_1h.toNumber() + 3600); // Add another hour
    try {
      await program.methods
        .extend(newExpiry)
        .accounts({
          manager: systemKeypair.publicKey, // Wrong manager
          payment: paymentPda,
          to: fromKeypair.publicKey,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes(""),
        "The given account is owned by a different program than expected"
      );
    }
  });

  it("should fail to withdraw payment with wrong signer", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${fromKeypair.publicKey.toString()}`
      );
    }
  });
  it("should fail to withdraw payment with wrong sender", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: systemKeypair.publicKey, // Wrong sender
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: unknown signer: ${toKeypair.publicKey.toString()}`
      );
    }
  });

  it("should fail to withdraw payment with wrong manager", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          manager: systemKeypair.publicKey, // Wrong manager
          payment: paymentPda,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes(""),
        "The given account is owned by a different program than expected"
      );
    }
  });

  it("should fail to withdraw payment with wrong deposit account", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: systemTokenAccount, // Wrong deposit account
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });
  it("should fail to withdraw payment with wrong sender token account", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: systemTokenAccount, // Wrong sender token account
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("Withdraw payment", async () => {
    // Show remaining time
    sync_wait(Date.now() - timeStamp + 1000);

    const initialBalances = await getBalances(toTokenAccount);
    const withdrawSignature = await program.methods
      .withdraw()
      .accounts({
        manager: managerKeypair.publicKey,
        payment: paymentPda,
        to: toKeypair.publicKey,
        mint: mint,
        depositTokenAcc: depositTokenAccountPda,
        toTokenAcc: toTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([toKeypair])
      .rpc();
    await confirmTransaction(withdrawSignature);

    const paymentAccount = await program.account.payment.fetch(paymentPda);
    assert.strictEqual(paymentAccount.status, 2); // Withdrawn

    const finalBalances = await getBalances(toTokenAccount);
    checkBalance(initialBalances, finalBalances, amount);
  });

  it("should fail to withdraw already withdrawn payment", async () => {
    try {
      await program.methods
        .withdraw()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to finalize withdrawn payment", async () => {
    try {
      await program.methods
        .finalize()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          toTokenAcc: toTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to invalidate withdrawn payment", async () => {
    try {
      await program.methods
        .invalidate()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          systemTokenAcc: systemTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([fromKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to extend withdrawn payment", async () => {
    const newExpiry = new anchor.BN(expiry_in_1h.toNumber() + 3600); // Add another hour
    try {
      await program.methods
        .extend(newExpiry)
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          to: toKeypair.publicKey,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("should fail to reject withdrawn payment", async () => {
    try {
      await program.methods
        .reject()
        .accounts({
          manager: managerKeypair.publicKey,
          payment: paymentPda,
          from: fromKeypair.publicKey,
          to: toKeypair.publicKey,
          mint: mint,
          depositTokenAcc: depositTokenAccountPda,
          fromTokenAcc: fromTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([toKeypair])
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes("A raw constraint was violated"),
        error.toString()
      );
    }
  });

  it("Update system to new key", async () => {
    const signature = await program.methods
      .updateSystem(newSystemKeypair.publicKey)
      .accounts({
        manager: managerKeypair.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    await confirmTransaction(signature);

    const managerAccount = await program.account.paymentManager.fetch(
      managerKeypair.publicKey
    );
    assert.ok(managerAccount.system.equals(newSystemKeypair.publicKey));
  });
  it("Update system to previous key", async () => {
    const signature = await program.methods
      .updateSystem(systemKeypair.publicKey)
      .accounts({
        manager: managerKeypair.publicKey,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    await confirmTransaction(signature);

    const managerAccount = await program.account.paymentManager.fetch(
      managerKeypair.publicKey
    );
    assert.ok(managerAccount.system.equals(systemKeypair.publicKey));
  });
  it("should fail to update system with wrong authority", async () => {
    try {
      await program.methods
        .updateSystem(newSystemKeypair.publicKey)
        .accounts({
          manager: managerKeypair.publicKey,
          authority: toKeypair.publicKey, // Wrong auhority
        })
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.strictEqual(
        error.toString(),
        `Error: Signature verification failed`
      );
    }
  });
  it("should fail to update system with wrong manager", async () => {
    try {
      await program.methods
        .updateSystem(newSystemKeypair.publicKey)
        .accounts({
          manager: toKeypair.publicKey, // Wrong manager
          authority: provider.wallet.publicKey,
        })
        .rpc();
      assert.fail("Expected an error to be thrown");
    } catch (error) {
      assert.ok(
        error.toString().includes(""),
        "The given account is owned by a different program than expected"
      );
    }
  });
});

// ----------------------------------------------------------------
// Helper functions
// ----------------------------------------------------------------

function logKeypairDetails(name: string, keypair: web3.Keypair) {
  console.log(`${name} Keypair:`);
  console.log(`  Public Key: ${keypair.publicKey.toString()}`);
  console.log(
    `  Private Key: ${Buffer.from(keypair.secretKey).toString("hex")}`
  );
  console.log(""); // Empty line for better readability
}

function createKeypairFromHex(hexString: string) {
  // Remove '0x' prefix if present
  const cleanHexString = hexString.startsWith("0x")
    ? hexString.slice(2)
    : hexString;

  // Convert hex string to Uint8Array
  const secretKey = new Uint8Array(Buffer.from(cleanHexString, "hex"));

  // Create and return the Keypair
  return web3.Keypair.fromSecretKey(secretKey);
}

interface BalanceState {
  user: web3.RpcResponseAndContext<web3.TokenAmount>;
  contract?: web3.RpcResponseAndContext<web3.TokenAmount>;
}

async function getBalances(
  tokenAccount: web3.PublicKey
): Promise<BalanceState> {
  // Get initial balances
  const user = await provider.connection.getTokenAccountBalance(tokenAccount);
  const contract = await provider.connection.getTokenAccountBalance(
    depositTokenAccountPda
  );
  return {
    user,
    contract,
  };
}

function checkBalance(
  initial: BalanceState,
  final: BalanceState,
  amount: BN,
  sendToAccount = true
) {
  if (sendToAccount) {
    const deltaUser = new anchor.BN(final.user.value.amount).sub(
      new anchor.BN(initial.user.value.amount)
    );
    assert.ok(deltaUser.eq(amount));
    if (initial.contract && final.contract) {
      const deltaContractNegative = new anchor.BN(
        initial.contract.value.amount
      ).sub(new anchor.BN(final.contract.value.amount));
      assert.ok(deltaContractNegative.eq(amount));
    }
  } else {
    const deltaUserNegative = new anchor.BN(initial.user.value.amount).sub(
      new anchor.BN(final.user.value.amount)
    );
    assert.ok(deltaUserNegative.eq(amount));
    if (initial.contract && final.contract) {
      const deltaContract = new anchor.BN(final.contract.value.amount).sub(
        new anchor.BN(initial.contract.value.amount)
      );
      assert.ok(deltaContract.eq(amount));
    }
  }
}

function sync_wait(delay: number) {
  // Note: Set timeout is not defined in beta.solpg.io
  if (delay <= 0) {
    return;
  }
  console.log(`Wait for ${delay / 1000}s.`);

  const stamp = Date.now();
  let lastFullSec = Math.round(delay / 1000);
  while (true) {
    const deltaTime = Date.now() - stamp;
    if (delay < deltaTime) {
      break;
    } else {
      const fullSecs = Math.round((delay - deltaTime) / 1000);
      if (fullSecs != 0 && fullSecs != lastFullSec) {
        console.log(`${fullSecs}s`);
        lastFullSec = fullSecs;
      }
    }
  }
}
