"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  EVENT_DISPLAY,
  EventAccount,
  FaceValueTxError,
  PROGRAM_ID,
  TicketAccount,
  WithKey,
  dollarsToLamports,
  explorerAddr,
  explorerTx,
  fetchEvents,
  fetchTickets,
  fmtDollars,
  getProgram,
  ix,
  parseError,
  sendIx,
  short,
  toDollars,
} from "@/lib/facevalue";

// The wallet button touches `window`, so render it only in the browser.
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

type Toast = { id: number; text: string; sig?: string };
type Banner = { kind: "blocked" | "error"; text: string } | null;

export default function Home() {
  if (!PROGRAM_ID) return <SetupScreen />;
  return <App />;
}

function App() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const program = useMemo(() => getProgram(connection), [connection]);

  const [isOrganizerView, setIsOrganizerView] = useState(false);
  const [eventParam, setEventParam] = useState<string | null>(null);
  const [events, setEvents] = useState<WithKey<EventAccount>[] | null>(null);
  const [tickets, setTickets] = useState<WithKey<TicketAccount>[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setIsOrganizerView(q.get("organizer") === "1");
    setEventParam(q.get("event"));
  }, []);

  // Which event are we showing? ?event=<address> wins, otherwise the newest event.
  const event = useMemo(() => {
    if (!events) return null;
    if (eventParam) return events.find((e) => e.publicKey.toBase58() === eventParam) ?? null;
    return events[0] ?? null;
  }, [events, eventParam]);

  const refresh = useCallback(async () => {
    try {
      const evs = await fetchEvents(program);
      setEvents(evs);
      const current = eventParam ? evs.find((e) => e.publicKey.toBase58() === eventParam) : evs[0];
      setTickets(current ? await fetchTickets(program, current.publicKey) : []);
      if (publicKey) setBalance(await connection.getBalance(publicKey, "confirmed"));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(String(e?.message ?? e));
    }
  }, [program, eventParam, publicKey, connection]);

  // Poll so two browser windows stay in sync during the demo.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!publicKey) setBalance(null);
  }, [publicKey]);

  const toast = (text: string, sig?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, sig }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 10000);
  };

  /** Run one instruction: simulate → wallet signs → confirm → toast, or show a friendly banner. */
  const run = async (label: string, success: string, build: () => Promise<TransactionInstruction>) => {
    if (!publicKey) {
      setBanner({ kind: "error", text: "Connect your Phantom wallet first (top right)." });
      return;
    }
    setBusy(label);
    setBanner(null);
    try {
      const instruction = await build();
      const sig = await sendIx(connection, publicKey, [instruction], sendTransaction);
      toast(success, sig);
      await refresh();
    } catch (e) {
      const err = e instanceof FaceValueTxError ? e : parseError(e);
      if (err.logs.length) console.log("Program logs:\n" + err.logs.join("\n"));
      if (err.code === "PriceAboveFace") setBanner({ kind: "blocked", text: err.message });
      else if (err.code !== "Rejected") setBanner({ kind: "error", text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const mine = tickets.filter((t) => publicKey && t.account.owner.equals(publicKey));
  const market = tickets.filter((t) => t.account.listed && !t.account.used);
  const isOrganizer = !!(publicKey && event && event.account.organizer.equals(publicKey));

  return (
    <>
      <header className="topbar">
        <div className="brand">
          FaceValue
          <small>Student tickets that can never be resold above face value</small>
        </div>
        <div className="wallet-area">
          {balance !== null && (
            <div className="balance">
              Wallet: <b>{(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL</b>
              <br />
              <span style={{ opacity: 0.85 }}>≈ {fmtDollars(balance)} demo dollars</span>
            </div>
          )}
          <WalletMultiButton />
        </div>
      </header>

      <main>
        {banner && <BannerView banner={banner} face={event ? fmtDollars(event.account.facePrice) : "$50"} onClose={() => setBanner(null)} />}
        {loadError && (
          <div className="banner info">
            Couldn&apos;t reach Solana devnet right now: <code>{loadError}</code>. Retrying every few seconds.
          </div>
        )}


        {events === null ? (
          <div className="card">Loading event from Solana devnet…</div>
        ) : !event ? (
          <div className="card">
            <h2>No event yet</h2>
            {eventParam ? (
              <p>No event found at <code>{eventParam}</code>.</p>
            ) : (
              <p>
                The organizer needs to create one first: open{" "}
                <a href="?organizer=1">
                  <code>?organizer=1</code>
                </a>
                , connect the organizer wallet and click <b>Create event</b>.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* 1. Event card */}
            <section className="card">
              <p className="event-title">{EVENT_DISPLAY.title}</p>
              <p className="event-sub">{EVENT_DISPLAY.subtitle}</p>
              <div className="event-row">
                <div>
                  <div className="price">
                    {fmtDollars(event.account.facePrice)}
                    <small>face value</small>
                  </div>
                  <div className="sold">
                    {event.account.sold} of {event.account.maxSupply} sold
                  </div>
                  <div className="bar">
                    <div style={{ width: `${(100 * event.account.sold) / event.account.maxSupply}%` }} />
                  </div>
                </div>
                <button
                  className="big"
                  disabled={!!busy || event.account.sold >= event.account.maxSupply}
                  onClick={() =>
                    run("buy", `You bought a ticket for ${fmtDollars(event.account.facePrice)}`, () =>
                      ix.buyTicket(program, publicKey!, event)
                    )
                  }
                >
                  {event.account.sold >= event.account.maxSupply
                    ? "Sold out"
                    : busy === "buy"
                    ? "Buying…"
                    : publicKey
                    ? "Buy ticket"
                    : "Connect wallet to buy"}
                </button>
              </div>
            </section>

            {/* 2. My tickets */}
            <section className="card">
              <h2>My tickets</h2>
              {!publicKey ? (
                <div className="empty">Connect your wallet to see your tickets.</div>
              ) : mine.length === 0 ? (
                <div className="empty">You don&apos;t have any tickets yet.</div>
              ) : (
                mine.map((t) => (
                  <MyTicketRow
                    key={t.publicKey.toBase58()}
                    t={t}
                    face={event.account.facePrice}
                    busy={busy}
                    onList={(price) =>
                      run(`list-${t.account.ticketId}`, `Ticket #${t.account.ticketId} listed for ${fmtDollars(price)}`, () =>
                        ix.listTicket(program, publicKey, t, price)
                      )
                    }
                    onCancel={() =>
                      run(`cancel-${t.account.ticketId}`, `Listing for ticket #${t.account.ticketId} cancelled`, () =>
                        ix.cancelListing(program, publicKey, t)
                      )
                    }
                  />
                ))
              )}
            </section>

            {/* 3. Resale market */}
            <section className="card gray">
              <div className="section-head">
                <h2>Resale market</h2>
                <span className="badge">
                  Face value: {fmtDollars(event.account.facePrice)} · Max resale: {fmtDollars(event.account.facePrice)}
                </span>
              </div>
              {market.length === 0 ? (
                <div className="empty">No tickets for resale right now.</div>
              ) : (
                market.map((t) => {
                  const own = !!publicKey && t.account.owner.equals(publicKey);
                  return (
                    <div className="row" key={t.publicKey.toBase58()}>
                      <div className="tnum">Ticket #{t.account.ticketId}</div>
                      <div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{fmtDollars(t.account.askPrice)}</div>
                      <div className="muted">
                        Seller{" "}
                        <a href={explorerAddr(t.account.owner.toBase58())} target="_blank" rel="noreferrer">
                          {short(t.account.owner)}
                        </a>
                      </div>
                      {own ? (
                        <span className="muted">Your listing</span>
                      ) : (
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            run(
                              `resale-${t.account.ticketId}`,
                              `Ticket #${t.account.ticketId} is yours. You paid ${fmtDollars(t.account.askPrice)} straight to the seller`,
                              () => ix.buyResale(program, publicKey!, t)
                            )
                          }
                        >
                          {busy === `resale-${t.account.ticketId}` ? "Buying…" : publicKey ? "Buy" : "Connect to buy"}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </section>

            {/* Organizer: check-in */}
            {isOrganizerView && (
              <section className="card gray">
                <h2>
                  Gate check-in <span className="org-tag">ORGANIZER</span>
                </h2>
                {!isOrganizer && (
                  <p className="hint">
                    Connect the organizer wallet ({short(event.account.organizer)}) to check tickets in. Anyone else gets
                    rejected by the program.
                  </p>
                )}
                {tickets.length === 0 ? (
                  <div className="empty">No tickets sold yet.</div>
                ) : (
                  tickets.map((t) => (
                    <div className="row" key={t.publicKey.toBase58()}>
                      <div className="tnum">
                        Ticket #{t.account.ticketId}
                        <StatusPill t={t.account} />
                      </div>
                      <div className="muted">
                        Owner{" "}
                        <a href={explorerAddr(t.account.owner.toBase58())} target="_blank" rel="noreferrer">
                          {short(t.account.owner)}
                        </a>
                      </div>
                      <button
                        className="dark"
                        disabled={!!busy || t.account.used}
                        onClick={() =>
                          run(`checkin-${t.account.ticketId}`, `Ticket #${t.account.ticketId} checked in`, () =>
                            ix.checkIn(program, publicKey!, t)
                          )
                        }
                      >
                        {t.account.used ? "Checked in" : busy === `checkin-${t.account.ticketId}` ? "Checking in…" : "Check in"}
                      </button>
                    </div>
                  ))
                )}
                <p className="hint">
                  Event account:{" "}
                  <a href={explorerAddr(event.publicKey.toBase58())} target="_blank" rel="noreferrer">
                    <code>{event.publicKey.toBase58()}</code>
                  </a>
                </p>
              </section>
            )}
          </>
        )}
        {isOrganizerView && (
          <OrganizerPanel
            busy={busy}
            publicKey={publicKey}
            event={event}
            onCreate={(eventId, name, facePrice, maxSupply) =>
              run("create", `Event “${name}” created`, () =>
                ix.createEvent(program, publicKey!, eventId, name, facePrice, maxSupply)
              )
            }
          />
        )}
        <p className="hint" style={{ textAlign: "center" }}>
          Running on Solana devnet. Make sure Phantom is set to <b>Devnet</b> (Settings → Developer settings → Testnet mode).
        </p>
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            ✅ {t.text}
            {t.sig && (
              <>
                <br />
                <a href={explorerTx(t.sig)} target="_blank" rel="noreferrer">
                  View on Solana Explorer ↗
                </a>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function StatusPill({ t }: { t: TicketAccount }) {
  if (t.used) return <span className="pill used">Used</span>;
  if (t.listed) return <span className="pill listed">Listed</span>;
  return <span className="pill owned">Owned</span>;
}

function MyTicketRow({
  t,
  face,
  busy,
  onList,
  onCancel,
}: {
  t: WithKey<TicketAccount>;
  face: BN;
  busy: string | null;
  onList: (price: BN) => void;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(String(toDollars(face)));
  const id = t.account.ticketId;
  const dollars = Number(price);
  return (
    <div className="row">
      <div className="tnum">
        Ticket #{id}
        <StatusPill t={t.account} />
      </div>
      {t.account.used ? (
        <span className="muted">Checked in at the gate. Can&apos;t be resold.</span>
      ) : t.account.listed ? (
        <div className="actions">
          <span className="muted">Listed for {fmtDollars(t.account.askPrice)}</span>
          <button className="secondary" disabled={!!busy} onClick={onCancel}>
            {busy === `cancel-${id}` ? "Cancelling…" : "Cancel listing"}
          </button>
        </div>
      ) : (
        <div className="actions">
          <div className="dollar-input">
            <span>$</span>
            <input
              type="number"
              min={1}
              step={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-label="Resale price in dollars"
            />
          </div>
          {/* No client-side cap check on purpose: the program is the one that says no. */}
          <button disabled={!!busy || !(dollars > 0)} onClick={() => onList(dollarsToLamports(dollars))}>
            {busy === `list-${id}` ? "Listing…" : "List for resale"}
          </button>
        </div>
      )}
    </div>
  );
}

function BannerView({ banner, face, onClose }: { banner: NonNullable<Banner>; face: string; onClose: () => void }) {
  if (banner.kind === "blocked")
    return (
      <div className="banner blocked" role="alert">
        <button className="close" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
        <div className="big-line">🚫 Blocked by the ticket itself.</div>
        Resale price can&apos;t exceed face value ({face}).{" "}
        <i>This rule is enforced onchain. No one can override it.</i>
      </div>
    );
  return (
    <div className="banner" role="alert">
      <button className="close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
      <b>{banner.text}</b>
    </div>
  );
}

function OrganizerPanel({
  busy,
  publicKey,
  event,
  onCreate,
}: {
  busy: string | null;
  publicKey: PublicKey | null;
  event: WithKey<EventAccount> | null;
  onCreate: (eventId: BN, name: string, facePrice: BN, maxSupply: number) => void;
}) {
  const [name, setName] = useState("OSU Student Section");
  const [price, setPrice] = useState("50");
  const [supply, setSupply] = useState("100");
  const nameBytes = new TextEncoder().encode(name).length;
  return (
    <section className="card gray">
      <h2>
        Create event <span className="org-tag">ORGANIZER</span>
      </h2>
      <div className="form">
        <label>
          Name (max 32 characters)
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Face price ($)
          <input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label>
          Tickets
          <input type="number" min={1} value={supply} onChange={(e) => setSupply(e.target.value)} />
        </label>
        <button
          disabled={!!busy || !publicKey || nameBytes > 32}
          onClick={() =>
            onCreate(new BN(Date.now()), name, dollarsToLamports(Number(price)), Math.floor(Number(supply)))
          }
        >
          {busy === "create" ? "Creating…" : "Create event"}
        </button>
      </div>
      <p className="hint">
        {publicKey ? (
          <>
            The connected wallet ({short(publicKey)}) becomes the organizer and receives every face-value sale. $50 = 0.05
            devnet SOL. The page always shows the newest event.
          </>
        ) : (
          "Connect the organizer wallet first."
        )}
        {event && <> Current event was created by {short(event.account.organizer)}.</>}
      </p>
    </section>
  );
}

function SetupScreen() {
  return (
    <main>
      <div className="card">
        <h2>Almost there: set your Program ID</h2>
        <ol>
          <li>
            Deploy <code>program/src/lib.rs</code> from Solana Playground (beta.solpg.io) to devnet.
          </li>
          <li>
            Open <code>app/lib/config.ts</code> and paste the Program ID between the quotes of{" "}
            <code>PROGRAM_ID_STRING</code>, then save. The page reloads by itself.
          </li>
        </ol>
      </div>
    </main>
  );
}
