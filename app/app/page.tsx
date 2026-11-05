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
  ORGANIZER,
  PROGRAM_ID,
  TicketAccount,
  WithKey,
  dollarsToLamports,
  explorerAddr,
  explorerTx,
  eventPda,
  fetchEvent,
  fetchNewestEventKey,
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
  const [eventParam, setEventParam] = useState<string | null | undefined>(undefined); // undefined until the URL is read
  const [event, setEvent] = useState<WithKey<EventAccount> | null | undefined>(undefined); // undefined while loading
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

  // Without ?event= we show the newest event. Finding it is the rate-limited "list all events" call, so it reruns
  // only every 30 s (every poll while there's no event yet); the polls in between read the known address.
  const newest = useRef<{ key: PublicKey | null; at: number } | null>(null);
  // Polls can overlap when the RPC is slow; an older one that lands late must not overwrite newer data.
  const sentSeq = useRef(0);
  const shownSeq = useRef(0);

  // Which event are we showing? ?event=<address> wins, otherwise the newest event.
  const refresh = useCallback(async () => {
    if (eventParam === undefined) return; // URL not read yet
    const seq = ++sentSeq.current;
    try {
      let key: PublicKey | null = null;
      if (eventParam) {
        try {
          key = new PublicKey(eventParam);
        } catch {} // not an address: shows "No event found"
      } else {
        if (!newest.current?.key || Date.now() - newest.current.at > 30000)
          newest.current = { key: await fetchNewestEventKey(program), at: Date.now() };
        key = newest.current.key;
      }
      const ev = key ? await fetchEvent(program, key) : null;
      const tix = ev ? await fetchTickets(program, ev) : [];
      const bal = publicKey ? await connection.getBalance(publicKey, "confirmed") : null;
      if (seq < shownSeq.current) return;
      shownSeq.current = seq;
      // Set together, so tickets you already own don't flash as "new" on page load.
      setEvent(ev);
      setTickets(tix);
      setBalance(bal);
      setLoadError(null);
    } catch (e: any) {
      if (seq > shownSeq.current) setLoadError(String(e?.message ?? e));
    }
  }, [program, eventParam, publicKey, connection]);

  // Poll so two browser windows stay in sync during the demo.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // A window pinned with ?event= never lists other events, so check now and then whether a newer one exists.
  const [newerEvent, setNewerEvent] = useState<string | null>(null);
  useEffect(() => {
    if (!eventParam) return;
    const check = () =>
      fetchNewestEventKey(program)
        .then((k) => setNewerEvent(k && k.toBase58() !== eventParam ? k.toBase58() : null))
        .catch(() => {}); // best effort; the main poll already reports RPC errors
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [program, eventParam]);

  useEffect(() => {
    if (!publicKey) setBalance(null);
  }, [publicKey]);

  // The top bar is sticky and can wrap on narrow windows; share its height so sticky banners sit just under it.
  const topbarRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    if (event === undefined) return;
    const now = new Set(mineKeys ? mineKeys.split(",") : []);
    const before = prevMine.current;
    prevMine.current = now;
    if (!before) return;
    const added = Array.from(now).filter((k) => !before.has(k));
    if (!added.length) return;
    setFresh((f) => new Set([...Array.from(f), ...added]));
    setTimeout(() => setFresh((f) => new Set(Array.from(f).filter((k) => !added.includes(k)))), 4000);
  }, [mineKeys, event]);

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
      <header className="topbar" ref={topbarRef}>
        <div className="topbar-inner">
        <div className="brand">
          <Logo />
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
              <span className="sub">≈ {fmtDollars(balance)} demo dollars</span>
            </div>
          )}
          <WalletMultiButton />
        </div>
        </div>
      </header>

      <main>
        {banner && <BannerView key={banner.n} banner={banner} face={event ? fmtDollars(event.account.facePrice) : "$50"} onClose={() => setBanner(null)} />}
        {loadError && (
          <div className="banner info">
            Couldn&apos;t reach Solana devnet right now: <code>{loadError}</code>. Retrying every few seconds.
          </div>
        )}
        {newerEvent && (
          <div className="banner info">
            A newer event exists.{" "}
            <a href={`?${isOrganizerView ? "organizer=1&" : ""}event=${newerEvent}`}>Switch to it</a>
          </div>
        )}


        {event === undefined ? (
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
          <div className="layout">
            {/* 1. Event card */}
            <section className="card hero">
              <div className="hero-art">
                <Guilloche />
                <div className="hero-top">
                  <span className="admit">Admit one</span>
                  <span className="serial">No. {short(event.publicKey)}</span>
                </div>
                <div>
                  <p className="event-title">{event.account.name}</p>
                  <p className="event-sub">{EVENT_DISPLAY.subtitle}</p>
                </div>
              </div>
              <div className="hero-body">
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
                      run(
                        "buy",
                        `You bought a ticket for ${fmtDollars(event.account.facePrice)} (plus a small Solana fee to store it)`,
                        // The new ticket's address comes from `sold`, so read it fresh instead of from the last poll.
                        async () => ix.buyTicket(program, publicKey!, (await fetchEvent(program, event.publicKey)) ?? event)
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
              </div>
            </section>

            <div className="stack">
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
                <div className="list">
                {mine.map((t) => (
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
                ))}
                </div>
              )}
            </section>

            {/* 3. Resale market */}
            <section className="card gray">
              <div className="section-head">
                <h2>
                  Resale market {market.length > 0 && <span className="count">{market.length}</span>}
                </h2>
                <span className="badge">
                  <ShieldIcon />
                  Face value: {fmtDollars(event.account.facePrice)} · Max resale: {fmtDollars(event.account.facePrice)}
                </span>
              </div>
              {market.length === 0 ? (
                <div className="empty">No tickets for resale right now.</div>
              ) : (
                <div className="list">
                {market.map((t) => {
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
                        <a className="addr" href={explorerAddr(t.account.owner.toBase58())} target="_blank" rel="noreferrer">
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
                })}
                </div>
              )}
            </section>

            </div>
          </div>
        )}
        {isOrganizerView && (
          <div className="org-grid">
            {/* Organizer: check-in */}
            {event && (
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
                        <a className="addr" href={explorerAddr(t.account.owner.toBase58())} target="_blank" rel="noreferrer">
                          {short(t.account.owner)}
                        </a>
                      </div>
                      <button
                        className={t.account.used ? "dark done" : "dark"}
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
          <OrganizerPanel
            busy={busy}
            publicKey={publicKey}
            event={event ?? null}
            onCreate={(eventId, name, facePrice, maxSupply) =>
              run("create", `Event “${name}” created`, () =>
                ix.createEvent(program, publicKey!, eventId, name, facePrice, maxSupply)
              ).then((ok) => {
                // Pin the new event so polling uses cheap lookups instead of the rate-limited "list all events" call.
                if (ok) window.location.search = `?organizer=1&event=${eventPda(publicKey!, eventId).toBase58()}`;
              })
            }
          />
          </div>
        )}
        <p className="hint footnote">
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
            <span className="toast-icon">
              <CheckIcon />
            </span>
            <div className="toast-body">
              {t.text}
              {t.sig && (
                <a href={explorerTx(t.sig)} target="_blank" rel="noreferrer">
                  View on Solana Explorer ↗
                </a>
              )}
            </div>
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
        {/* A crisp drawn version of the 🚫 from the demo script. */}
        <span className="banner-icon">
          <BanIcon />
        </span>
        <div className="banner-body">
          <div className="big-line">Blocked by the ticket itself.</div>
          {banner.attempt && (
            <div className="attempt">
              You asked <s>{banner.attempt}</s>. The most this ticket can ever sell for is <b>{face}</b>.
            </div>
          )}
          <div className="rule">
            Resale price can&apos;t exceed face value ({face}).{" "}
            <i>This rule is enforced onchain. No one can override it.</i>
          </div>
        </div>
      </div>
    );
  return (
    <div className="banner" role="alert">
      <button className="close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
      <span className="banner-icon small">
        <AlertIcon />
      </span>
      <div className="banner-body">
        <b>{banner.text}</b>
      </div>
    </div>
  );
}

/* ---------- Brand and icons (inline SVG, so they stay sharp on a projector) ---------- */

function Logo() {
  return (
    <span className="logo" aria-hidden>
      <svg viewBox="0 0 40 40" fill="none">
        <defs>
          <linearGradient id="fv-logo-fill" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6A5CFF" />
            <stop offset="0.42" stopColor="#A64DFF" />
            <stop offset="0.78" stopColor="#F0479E" />
            <stop offset="1" stopColor="#FF9A3C" />
          </linearGradient>
          {/* A ticket with two notches and a perforation, cut out of white. */}
          <mask id="fv-logo-ticket" maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
            <rect x="8.5" y="13" width="23" height="14" rx="3" fill="#fff" />
            <circle cx="8.5" cy="20" r="2.7" fill="#000" />
            <circle cx="31.5" cy="20" r="2.7" fill="#000" />
            <path d="M25 14.6v10.8" stroke="#000" strokeWidth="1.5" strokeDasharray="1.7 1.5" />
          </mask>
        </defs>
        <rect width="40" height="40" rx="12" fill="url(#fv-logo-fill)" />
        <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="11.25" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.5" />
        <g transform="rotate(-12 20 20)">
          <rect x="8.5" y="13" width="23" height="14" rx="3" fill="#fff" mask="url(#fv-logo-ticket)" />
        </g>
      </svg>
    </span>
  );
}

// Overlapping ellipses and circles: the rosette pattern printed on banknotes and premium tickets.
const ROSETTE_ELLIPSES = Array.from({ length: 36 }, (_, i) => i * 5);
const ROSETTE_CIRCLES = Array.from({ length: 24 }, (_, i) => (i / 24) * 2 * Math.PI);
function Guilloche() {
  return (
    <svg className="guilloche" viewBox="-200 -200 400 400" aria-hidden>
      <g fill="none" strokeWidth="0.8">
        {ROSETTE_ELLIPSES.map((deg) => (
          <ellipse key={`e${deg}`} rx="192" ry="62" transform={`rotate(${deg})`} />
        ))}
        {ROSETTE_CIRCLES.map((t, i) => (
          <circle key={`c${i}`} cx={(Math.cos(t) * 64).toFixed(2)} cy={(Math.sin(t) * 64).toFixed(2)} r="118" />
        ))}
      </g>
    </svg>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function BanIcon() {
  return (
    <svg {...iconProps} strokeWidth={2.6}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...iconProps} strokeWidth={2.4}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v5" />
      <path d="M12 16.3h.01" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps} strokeWidth={3}>
      <path d="M5.5 12.5l4.2 4.2L18.5 8" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...iconProps} strokeWidth={2}>
      <path d="M12 3l7.5 3v5.6c0 4.5-3.1 8.2-7.5 9.4-4.4-1.2-7.5-4.9-7.5-9.4V6L12 3z" />
      <path d="M8.8 12.1l2.3 2.3 4.2-4.5" />
    </svg>
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
            devnet SOL.{" "}
            {ORGANIZER && !publicKey.equals(ORGANIZER)
              ? `This page only shows events from ${short(ORGANIZER)} (set in app/lib/config.ts), so connect that wallet first.`
              : "The page always shows the newest event."}
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
