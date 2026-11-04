// Everything the frontend knows about the onchain program lives here.
import { AnchorError, AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import idlJson from "./facevalue.json";
import { DEVNET_RPC_URL, PROGRAM_ID_STRING } from "./config";

// lib/config.ts is the normal place to set these; env vars override it if you prefer.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || DEVNET_RPC_URL;
const RAW_PROGRAM_ID = (process.env.NEXT_PUBLIC_PROGRAM_ID || PROGRAM_ID_STRING || "").trim();

export const PROGRAM_ID: PublicKey | null = (() => {
  try {
    return RAW_PROGRAM_ID ? new PublicKey(RAW_PROGRAM_ID) : null;
  } catch {
    return null;
  }
})();

// ---- Offchain display data (SPEC §4) ----
export const EVENT_DISPLAY = {
  title: "OSU Student Section — Saturday Game",
  subtitle: "Ohio Stadium · Saturday, 12:00 PM",
};
// Demo display rate only: 1 SOL = $1,000, so $1 = 1,000,000 lamports.
export const LAMPORTS_PER_DOLLAR = 1_000_000;
export const toDollars = (lamports: number | BN) =>
  Math.round((typeof lamports === "number" ? lamports : lamports.toNumber()) / LAMPORTS_PER_DOLLAR);
export const fmtDollars = (lamports: number | BN) => `$${toDollars(lamports).toLocaleString()}`;
export const dollarsToLamports = (d: number) => new BN(Math.round(d * LAMPORTS_PER_DOLLAR));

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
export const short = (k: PublicKey | string) => {
  const s = k.toString();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};

// ---- Types ----
export type EventAccount = {
  organizer: PublicKey;
  eventId: BN;
  name: string;
  facePrice: BN;
  maxSupply: number;
  sold: number;
  bump: number;
};
export type TicketAccount = {
  event: PublicKey;
  ticketId: number;
  owner: PublicKey;
  listed: boolean;
  askPrice: BN;
  used: boolean;
  bump: number;
};
export type WithKey<T> = { publicKey: PublicKey; account: T };

// ---- Program client ----
// A wallet that can't sign, used for reading before anyone connects.
const readonlyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async () => {
    throw new Error("read-only");
  },
  signAllTransactions: async () => {
    throw new Error("read-only");
  },
};

export function getProgram(connection: Connection) {
  if (!PROGRAM_ID) throw new Error("Program ID is not set in app/lib/config.ts");
  const idl = { ...(idlJson as object), address: PROGRAM_ID.toBase58() } as Idl;
  const provider = new AnchorProvider(connection, readonlyWallet as any, { commitment: "confirmed" });
  return new Program(idl, provider);
}

export const eventPda = (organizer: PublicKey, eventId: BN) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("event"), organizer.toBuffer(), eventId.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID!
  )[0];

export const ticketPda = (event: PublicKey, ticketId: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("ticket"), event.toBuffer(), new BN(ticketId).toArrayLike(Buffer, "le", 4)],
    PROGRAM_ID!
  )[0];

export async function fetchEvents(program: Program): Promise<WithKey<EventAccount>[]> {
  const all = (await (program.account as any).event.all()) as WithKey<EventAccount>[];
  return all.sort((a, b) => b.account.eventId.cmp(a.account.eventId)); // newest first
}

// One event by address via getAccountInfo, which the public devnet RPC rate-limits far less than getProgramAccounts.
export async function fetchEvent(program: Program, address: PublicKey): Promise<WithKey<EventAccount>[]> {
  const account = (await (program.account as any).event.fetchNullable(address)) as EventAccount | null;
  return account ? [{ publicKey: address, account }] : [];
}

export async function fetchTickets(program: Program, event: WithKey<EventAccount>): Promise<WithKey<TicketAccount>[]> {
  // Tickets are PDAs numbered 0..sold-1, so one getMultipleAccounts call finds them all (no getProgramAccounts).
  const keys = Array.from({ length: event.account.sold }, (_, i) => ticketPda(event.publicKey, i));
  const accounts = (await (program.account as any).ticket.fetchMultiple(keys)) as (TicketAccount | null)[];
  return keys.flatMap((publicKey, i) => (accounts[i] ? [{ publicKey, account: accounts[i]! }] : []));
}

// ---- Instruction builders (names and accounts frozen in SPEC §5) ----
type Methods = any;
const m = (p: Program): Methods => p.methods;

export const ix = {
  createEvent: (p: Program, organizer: PublicKey, eventId: BN, name: string, facePrice: BN, maxSupply: number) =>
    m(p)
      .createEvent(eventId, name, facePrice, maxSupply)
      .accountsStrict({ event: eventPda(organizer, eventId), organizer, systemProgram: SystemProgram.programId })
      .instruction() as Promise<TransactionInstruction>,

  buyTicket: (p: Program, buyer: PublicKey, event: WithKey<EventAccount>) =>
    m(p)
      .buyTicket()
      .accountsStrict({
        event: event.publicKey,
        ticket: ticketPda(event.publicKey, event.account.sold),
        organizer: event.account.organizer,
        buyer,
        systemProgram: SystemProgram.programId,
      })
      .instruction() as Promise<TransactionInstruction>,

  listTicket: (p: Program, owner: PublicKey, ticket: WithKey<TicketAccount>, price: BN) =>
    m(p)
      .listTicket(price)
      .accountsStrict({ event: ticket.account.event, ticket: ticket.publicKey, owner })
      .instruction() as Promise<TransactionInstruction>,

  cancelListing: (p: Program, owner: PublicKey, ticket: WithKey<TicketAccount>) =>
    m(p)
      .cancelListing()
      .accountsStrict({ ticket: ticket.publicKey, owner })
      .instruction() as Promise<TransactionInstruction>,

  buyResale: (p: Program, buyer: PublicKey, ticket: WithKey<TicketAccount>) =>
    m(p)
      .buyResale()
      .accountsStrict({
        event: ticket.account.event,
        ticket: ticket.publicKey,
        seller: ticket.account.owner,
        buyer,
        systemProgram: SystemProgram.programId,
      })
      .instruction() as Promise<TransactionInstruction>,

  checkIn: (p: Program, organizer: PublicKey, ticket: WithKey<TicketAccount>) =>
    m(p)
      .checkIn()
      .accountsStrict({ event: ticket.account.event, ticket: ticket.publicKey, organizer })
      .instruction() as Promise<TransactionInstruction>,
};

// ---- Errors ----
const IDL_ERRORS: { code: number; name: string; msg: string }[] = (idlJson as any).errors;

export class FaceValueTxError extends Error {
  constructor(public code: string, message: string, public logs: string[] = []) {
    super(message);
  }
}

/** Turn whatever came back (simulation logs, wallet error, RPC error) into a friendly error. */
export function parseError(e: any, logs: string[] = [], rawErr?: any): FaceValueTxError {
  if (e instanceof FaceValueTxError) return e;
  const allLogs: string[] = logs.length ? logs : e?.logs || e?.transactionLogs || [];

  // 1. Anchor error in the program logs.
  let anchorErr: AnchorError | null = null;
  try {
    anchorErr = AnchorError.parse(allLogs);
  } catch {
    anchorErr = null;
  }
  if (anchorErr) {
    const { code, number } = anchorErr.error.errorCode;
    const known = IDL_ERRORS.find((x) => x.code === number);
    return new FaceValueTxError(code, known?.msg ?? anchorErr.error.errorMessage, allLogs);
  }

  // 2. Custom error number, e.g. {"InstructionError":[0,{"Custom":6000}]} or "custom program error: 0x1770".
  const text = JSON.stringify(rawErr ?? "") + " " + String(e?.message ?? e ?? "") + " " + allLogs.join("\n");
  const hex = text.match(/custom program error: (0x[0-9a-f]+)/i);
  const dec = text.match(/"Custom":(\d+)/);
  const num = hex ? parseInt(hex[1], 16) : dec ? parseInt(dec[1], 10) : null;
  if (num !== null) {
    const known = IDL_ERRORS.find((x) => x.code === num);
    if (known) return new FaceValueTxError(known.name, known.msg, allLogs);
    // System program: 1 = insufficient lamports.
    if (num === 1 && /insufficient lamports|11111111111111111111111111111111/.test(text))
      return new FaceValueTxError("NoFunds", "Not enough devnet SOL in this wallet. Get some at faucet.solana.com.", allLogs);
  }

  // 3. Last resort: match the message strings (SPEC §12 fallback).
  for (const x of IDL_ERRORS) if (text.includes(x.msg)) return new FaceValueTxError(x.name, x.msg, allLogs);

  if (/insufficient (funds|lamports)|no record of a prior credit|AccountNotFound/i.test(text))
    return new FaceValueTxError("NoFunds", "Not enough devnet SOL in this wallet. Get some at faucet.solana.com.", allLogs);
  if (/User rejected|rejected the request/i.test(text))
    return new FaceValueTxError("Rejected", "You cancelled the transaction in your wallet.", allLogs);
  return new FaceValueTxError("Unknown", String(e?.message ?? e ?? "Something went wrong"), allLogs);
}

/**
 * Simulate against the deployed program first (no signature needed), so a rule violation
 * like PriceAboveFace comes back from the program itself before the wallet ever pops up.
 * Then ask the wallet to sign and send, and wait for confirmation.
 */
export async function sendIx(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
  sendTransaction: (tx: VersionedTransaction, c: Connection) => Promise<string>
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(msg);

  const sim = await connection.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed" });
  if (sim.value.err) throw parseError(null, sim.value.logs ?? [], sim.value.err);

  let sig: string;
  try {
    sig = await sendTransaction(tx, connection);
  } catch (e) {
    throw parseError(e);
  }
  // Poll for confirmation (works even when websockets are blocked on venue Wi-Fi).
  for (let i = 0; i < 90; i++) {
    const { value } = await connection.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) {
      const t = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      throw parseError(null, t?.meta?.logMessages ?? [], st.err);
    }
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
    if (i % 5 === 4 && (await connection.getBlockHeight("confirmed")) > lastValidBlockHeight)
      throw new FaceValueTxError("Expired", "The network was too slow and the transaction expired. Please try again.");
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new FaceValueTxError("Timeout", "Still waiting for devnet to confirm. Check Explorer, then refresh.");
}

export { Transaction };
