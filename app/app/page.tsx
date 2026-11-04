"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  EVENT_DISPLAY,
  EventAccount,
  LAMPORTS_PER_DOLLAR,
  FaceValueTxError,
  PROGRAM_ID,
  TicketAccount,
  WithKey,
  dollarsToLamports,
  explorerAddr,
  explorerTx,
  eventPda,
  fetchEvent,
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
type Banner = { kind: "blocked" | "error"; text: string; attempt?: string; n: number } | null;

export default function Home() {
  if (!PROGRAM_ID) return <SetupScreen />;
  return <App />;
}

function App() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible: openWalletModal } = useWalletModal();
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
  // Short-lived highlights so the room can see what just changed.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [delta, setDelta] = useState<{ lamports: number; n: number } | null>(null);
  const prevMine = useRef<Set<string> | null>(null);
  const prevBalance = useRef<number | null>(null);

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
      const evs = eventParam ? await fetchEvent(program, new PublicKey(eventParam)) : await fetchEvents(program);
      setEvents(evs);
      const current = eventParam ? evs.find((e) => e.publicKey.toBase58() === eventParam) : evs[0];
      setTickets(current ? await fetchTickets(program, current) : []);
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
  const run = async (
    label: string,
    success: string,
    build: () => Promise<TransactionInstruction>,
    attempt?: string
  ) => {
    if (!publicKey) {
      openWalletModal(true);
      return;
    }
    setBusy(label);
    setBanner(null);
    try {
      const instruction = await build();
      const sig = await sendIx(connection, publicKey, [instruction], sendTransaction);
      toast(success, sig);
      await refresh();
      return true;
    } catch (e) {
      const err = e instanceof FaceValueTxError ? e : parseError(e);
      if (err.logs.length) console.log("Program logs:\n" + err.logs.join("\n"));
      const n = Date.now();
      if (err.code === "PriceAboveFace") setBanner({ kind: "blocked", text: err.message, attempt, n });
      else if (err.code !== "Rejected") setBanner({ kind: "error", text: err.message, n });
    } finally {
      setBusy(null);
    }
  };

  const mine = tickets.filter((t) => publicKey && t.account.owner.equals(publicKey));
  const market = tickets.filter((t) => t.account.listed && !t.account.used);
  const isOrganizer = !!(publicKey && event && event.account.organizer.equals(publicKey));

  // Flash a ticket when it lands in "My tickets" (bought, or bought from someone else).
  const mineKeys = mine.map((t) => t.publicKey.toBase58()).join(",");
  useEffect(() => {
    prevMine.current = null; // new wallet: don't flash every ticket it already has
    prevBalance.current = null;
  }, [publicKey]);
  useEffect(() => {
    if (events === null) return;
    const now = new Set(mineKeys ? mineKeys.split(",") : []);
    const before = prevMine.current;
    prevMine.current = now;
    if (!before) return;
    const added = Array.from(now).filter((k) => !before.has(k));
    if (!added.length) return;
    setFresh((f) => new Set([...Array.from(f), ...added]));
    setTimeout(() => setFresh((f) => new Set(Array.from(f).filter((k) => !added.includes(k)))), 4000);
  }, [mineKeys, events]);

  // Show "+$50" next to the balance when money arrives (e.g. the seller after a resale).
  useEffect(() => {
    if (balance === null) return;
    const before = prevBalance.current;
    prevBalance.current = balance;
    if (before === null) return;
    const diff = balance - before;
    if (Math.abs(diff) < LAMPORTS_PER_DOLLAR / 2) return; // ignore fee dust
    setDelta({ lamports: diff, n: Date.now() });
    const t = setTimeout(() => setDelta(null), 5000);
    return () => clearTimeout(t);
  }, [balance]);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            🎟️
          </span>
          <div>
            FaceValue <span className="net-pill">Devnet</span>
            <small>Student tickets that can never be resold above face value</small>
          </div>
        </div>
        <div className="wallet-area">
          {balance !== null && (
            <div className="balance">
              {delta && (
                <span key={delta.n} className={`delta ${delta.lamports > 0 ? "up" : "down"}`}>
                  {delta.lamports > 0 ? "+" : "−"}
                  {fmtDollars(Math.abs(delta.lamports))}
                </span>
              )}
              Wallet: <b>{(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL</b>
              <br />
              <span style={{ opacity: 0.85 }}>≈ {fmtDollars(balance)} demo dollars</span>
            </div>
          )}
          <WalletMultiButton />
        </div>
      </header>

      <main>
        {banner && <BannerView key={banner.n} banner={banner} face={event ? fmtDollars(event.account.facePrice) : "$50"} onClose={() => setBanner(null)} />}
        {loadError && (
          <div className="banner info">
            Couldn&apos;t reach Solana devnet right now: <code>{loadError}</code>. Retrying every few seconds.
          </div>
        )}


        {events === null ? (
          <div className="card loading">
            <span className="spin dark" /> Loading event from Solana devnet…
          </div>
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
                    {event.account.sold < event.account.maxSupply && (
                      <> · {event.account.maxSupply - event.account.sold} left</>
                    )}
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
                  {event.account.sold >= event.account.maxSupply ? (
                    "Sold out"
                  ) : busy === "buy" ? (
                    <Busy>Buying…</Busy>
                  ) : publicKey ? (
                    "Buy ticket"
                  ) : (
                    "Connect wallet to buy"
                  )}
                </button>
              </div>
            </section>

            {/* 2. My tickets */}
            <section className="card">
              <h2>
                My tickets {mine.length > 0 && <span className="count">{mine.length}</span>}
              </h2>
              {!publicKey ? (
                <div className="empty">
                  <button className="secondary" onClick={() => openWalletModal(true)}>
                    Connect wallet
                  </button>{" "}
                  to see your tickets.
                </div>
              ) : mine.length === 0 ? (
                <div className="empty">You don&apos;t have any tickets yet. Buy one above, or from the resale market.</div>
              ) : (
                mine.map((t) => (
                  <MyTicketRow
                    key={t.publicKey.toBase58()}
                    t={t}
                    face={event.account.facePrice}
                    busy={busy}
                    fresh={fresh.has(t.publicKey.toBase58())}
                    onList={(price) =>
                      run(
                        `list-${t.account.ticketId}`,
                        `Ticket #${t.account.ticketId} listed for ${fmtDollars(price)}`,
                        () => ix.listTicket(program, publicKey, t, price),
                        fmtDollars(price)
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
                <h2>
                  Resale market {market.length > 0 && <span className="count">{market.length}</span>}
                </h2>
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
                    <div className="row ticket" key={t.publicKey.toBase58()}>
                      <div className="tnum">Ticket #{t.account.ticketId}</div>
                      <div className="ask">
                        {fmtDollars(t.account.askPrice)}
                        {t.account.askPrice.eq(event.account.facePrice) && <small>at face</small>}
                      </div>
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
                          {busy === `resale-${t.account.ticketId}` ? (
                            <Busy>Buying…</Busy>
                          ) : publicKey ? (
                            "Buy"
                          ) : (
                            "Connect to buy"
                          )}
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
                    <div className="row ticket" key={t.publicKey.toBase58()}>
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
                        {t.account.used ? (
                          "Checked in"
                        ) : busy === `checkin-${t.account.ticketId}` ? (
                          <Busy>Checking in…</Busy>
                        ) : (
                          "Check in"
                        )}
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
              ).then((ok) => {
                // Pin the new event so polling uses cheap lookups instead of the rate-limited "list all events" call.
                if (ok) window.location.search = `?organizer=1&event=${eventPda(publicKey!, eventId).toBase58()}`;
              })
            }
          />
        )}
        <p className="hint" style={{ textAlign: "center" }}>
          Running on Solana devnet. Make sure Phantom is set to <b>Devnet</b> (Settings → Developer settings → Testnet mode).
        </p>
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div className="toast" key={t.id} role="status">
            <button
              className="close"
              aria-label="Dismiss"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
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

function Busy({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span className="spin" aria-hidden /> {children}
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
  fresh,
  onList,
  onCancel,
}: {
  t: WithKey<TicketAccount>;
  face: BN;
  busy: string | null;
  fresh: boolean;
  onList: (price: BN) => void;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(String(toDollars(face)));
  const id = t.account.ticketId;
  const dollars = Number(price);
  const canList = !busy && dollars > 0;
  return (
    <div className={`row ticket${fresh ? " fresh" : ""}`}>
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
            {busy === `cancel-${id}` ? <Busy>Cancelling…</Busy> : "Cancel listing"}
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
              onKeyDown={(e) => e.key === "Enter" && canList && onList(dollarsToLamports(dollars))}
              aria-label="Resale price in dollars"
            />
          </div>
          {/* No client-side cap check on purpose: the program is the one that says no. */}
          <button disabled={!canList} onClick={() => onList(dollarsToLamports(dollars))}>
            {busy === `list-${id}` ? <Busy>Listing…</Busy> : "List for resale"}
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
        {banner.attempt && (
          <div className="attempt">
            You asked <s>{banner.attempt}</s>. The most this ticket can ever sell for is <b>{face}</b>.
          </div>
        )}
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
          {busy === "create" ? <Busy>Creating…</Busy> : "Create event"}
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
