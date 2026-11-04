# FaceValue — Demo script (~90 seconds)

**Program ID (devnet):** `9gCTdqdJtobM3NxVt262EyfvcrAKmqy7NSaSwpRLRkg2`
**App:** `http://localhost:3000` (run `npm run dev` in `app/`)

Three wallets, three Chrome profiles:

| Window | Wallet | Role | Page |
|---|---|---|---|
| Left | **Alex** | Student who buys, then can't go | `http://localhost:3000` |
| Right | **Jordan** | Student who buys the resale | `http://localhost:3000` |
| Behind (alt-tab) | **Organizer** | Student org at the gate | `http://localhost:3000/?organizer=1` |

Use a separate organizer wallet: it receives every face-value sale, so if Alex were the organizer, the "Alex gets $50" moment would be muddled.

---

## Setup — the night before

- [ ] Program deployed to devnet, Program ID above pasted into `app/lib/config.ts`.
- [ ] In all three Chrome profiles, Phantom → Settings → Developer settings → **Testnet mode** on, network **Solana Devnet**.
- [ ] Fund each wallet with **≥ 1 devnet SOL** at https://faucet.solana.com (it rate-limits, so do it tonight, not in the room).
- [ ] Organizer profile: open `?organizer=1`, connect, **Create event** (defaults: "OSU Student Section", $50 face, 100 tickets).
- [ ] Copy the event address from the bottom of the organizer view. If you've made more than one event, add `?event=<address>` to all three URLs so everyone sees the same one.
- [ ] Do a full dry run, then start fresh: Alex's **My tickets** should be empty and the **Resale market** should say "No tickets for resale right now." (If old tickets are left over, create a new event and use its `?event=` link.)

## Setup — 10 minutes before

- [ ] Laptop on power, notifications off, browser zoom so text is readable from the back (≥ 18px base).
- [ ] Left = Alex, right = Jordan, side by side. Both connected (wallet button top right shows an address).
- [ ] Organizer window open on `?organizer=1`, connected, one alt-tab away.
- [ ] A Solana Explorer tab open (devnet) so the first load isn't slow.
- [ ] Backup screen recording of this script on the desktop, ready to play.
- [ ] Hard-refresh all three windows once.

---

## The script

Speaker = Partner B. *Italics* are what you say. **Bold** is what you click.

### 1 · Buy at face value (≈15s) — Alex, left window

1. Click **Buy ticket** on the event card → approve in Phantom.
2. Point at **My tickets**: ticket #0 with the **Owned** pill. The "X of 100 sold" bar ticks up.

> *"Alex grabs a student ticket at face value, fifty dollars. It's in Alex's wallet, on Solana."*

### 2 · The scalper move (≈20s) — Alex, left window ← **the moment**

1. In the price box under the ticket, change **50** to **80**.
2. Click **List for resale**.
3. The red banner appears: **🚫 Blocked by the ticket itself.** *This rule is enforced onchain. No one can override it.* (Phantom never pops up, because the app simulates the transaction against the program first and the program says no.)

> *"Alex can't go anymore and tries to flip it for eighty. On StubHub, that listing goes live. Here…"* — point at the banner — *"…the ticket refuses."*

**Stop talking for two seconds.** Let the room read it.

### 3 · List at face (≈15s) — Alex, left window

1. Dismiss the banner (×). Change the price back to **$50**.
2. Click **List for resale** → approve in Phantom. Pill changes to **Listed**.
3. Within ~4 seconds the ticket shows up in **Resale market** on *both* windows, next to the "Face value: $50 · Max resale: $50" badge.

> *"At fifty, it lists instantly. Fair price is the only price."*

### 4 · Atomic resale (≈20s) — Jordan, right window

1. In **Resale market**, click **Buy** on Alex's ticket → approve in Phantom.
2. Toast: "Ticket #0 is yours. You paid $50 straight to the seller." Click **View on Solana Explorer ↗**.
3. Point at the transaction: one transaction, SOL from Jordan to Alex, ticket owner changed. Back to the app: the ticket is now under Jordan's **My tickets** and gone from Alex's.

> *"Jordan pays, Alex gets fifty dollars, and the ticket moves, all in one transaction. Both happen or neither does. Nobody can get scammed in between."*

### 5 · Check in at the gate (≈20s) — Organizer window

1. Alt-tab to the organizer window (`?organizer=1`).
2. In **Gate check-in** (marked ORGANIZER), find ticket #0 owned by Jordan's address. Click **Check in** → approve in Phantom. Button changes to **Checked in**.
3. Alt-tab back to Jordan: pill shows **Used**, with "Checked in at the gate. Can't be resold."

> *"At the gate, the student org checks Jordan in. The ticket is marked used, so it can't be resold again. That's FaceValue."*

Hand back to the "What's next" slide in [`PITCH.md`](./PITCH.md).

---

## If something goes wrong

| What happens | Do this |
|---|---|
| Phantom pops up on the $80 listing instead of the red banner | Reject it. The program will still refuse it. Say *"even if you sign it, the chain rejects it"* and move on. |
| A window doesn't update after a listing or sale | Wait 4s (auto-refresh), then hard-refresh. Keep talking while it loads. |
| "No event yet" or a different event shows | Paste the `?event=<address>` link from setup. |
| Phantom says insufficient funds | Switch to the backup recording; you can't faucet fast enough in the room. |
| Devnet or Wi-Fi is down / RPC is very slow | *"Devnet's having a moment, here's the recording from this afternoon."* Play the backup. Narrate the same lines. |
| Running long | Cut step 5 (check-in). Steps 1–4 are the demo. |

## Rehearsal checklist

- [ ] Run the full script 3 times. Done = under 90 seconds, twice in a row with no errors (SPEC §7, P5).
- [ ] Record the backup screen capture Wednesday afternoon, with narration.
- [ ] Each rehearsal after the first needs a fresh state: create a new event (organizer window) and update the `?event=` links, or the market will still show old tickets.
