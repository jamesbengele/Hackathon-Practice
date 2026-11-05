# SPEC.md — FaceValue

> Student tickets that can never be resold above face value. The rule lives in the ticket itself, not in a company's terms of service.

**Track:** Consumer Apps · **Chain:** Solana devnet · **Pitch:** Wed Nov 4, 7 PM, Busch Honor Room (3 min + 1 min Q&A)

This file is the single source of truth. Every prompt to an AI starts by pasting this file. If the plan changes, change this file first.

---

## 1. The problem

**Who:** An Ohio State student trying to get into a sold-out game or concert.

**Pain:** Scalpers and bots buy student tickets at face value and resell them for 3–6× on StubHub and in group chats. The students who actually want to go either overpay or stay home. Organizers (student orgs, venues) can't enforce "no markup" once a ticket leaves their system.

**Why current fixes fail:** A price cap in a company's terms of service only works on that company's site. Once the ticket is a PDF, a screenshot or a transferable account, the cap is gone.

## 2. The one thing a judge should remember

> **Try to resell a $50 ticket for $80 → the blockchain rejects the transaction. List it at $50 → it sells instantly.**

Every build decision serves this moment.

## 3. Why it needs a blockchain

| Normal app | FaceValue |
|---|---|
| The cap is a policy the company *chooses* to enforce, and can change | The cap is code. Nobody, including us, can sell above face |
| Only works on that company's site | Any student org or venue can issue tickets under the same rule |
| Ownership is a row in a private database | Ownership is public and verifiable at the gate |
| Payment and transfer are separate steps, so scams happen in between | Payment and transfer happen in **one atomic transaction**: both or neither |

**Key design decision:** the ticket is **not** a freely transferable token. If it were a normal NFT, people could sell it on any marketplace and just send it, and the cap would mean nothing. Instead, the ticket is an account owned by our program, and the **only** way to change its `owner` is our `buy_resale` instruction, which enforces the cap.

## 4. What lives onchain vs. off

| Onchain (Anchor program) | Offchain (Next.js frontend) |
|---|---|
| Event: organizer, face price, supply, sold count | Event name/image, date, venue (hardcoded) |
| Ticket: owner, listed?, asking price, used? | Display price in "$" (hardcoded demo rate) |
| The price cap check | Friendly error messages |
| Payments (SOL) and ownership transfer | Wallet connection (Phantom) |
| Check-in (mark ticket used) | Organizer view toggle |

**Demo money:** devnet SOL. Face price = **0.05 SOL**, displayed as **"$50"** (hardcoded display rate: 1 SOL = $1,000 *for demo display only*). The real version uses USDC so prices are actually in dollars, and the pitch says so.

---

## 5. Program design (Anchor)

### Accounts

```rust
#[account]
#[derive(InitSpace)]
pub struct Event {
    pub organizer: Pubkey,
    pub event_id: u64,
    #[max_len(32)]
    pub name: String,
    pub face_price: u64,    // lamports
    pub max_supply: u32,
    pub sold: u32,          // also used as the next ticket_id
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub event: Pubkey,
    pub ticket_id: u32,
    pub owner: Pubkey,
    pub listed: bool,
    pub ask_price: u64,     // lamports, 0 when not listed
    pub used: bool,
    pub bump: u8,
}
```

**PDA seeds**
- Event: `["event", organizer, event_id.to_le_bytes()]`
- Ticket: `["ticket", event, ticket_id.to_le_bytes()]` (ticket_id = `event.sold` at time of purchase)

### Instructions

| # | Instruction | Signer | Does | Must fail when |
|---|---|---|---|---|
| 1 | `create_event(event_id, name, face_price, max_supply)` | organizer | Creates Event | name > 32 chars, face_price = 0, max_supply = 0 |
| 2 | `buy_ticket()` | buyer | Pays `face_price` buyer → organizer, creates Ticket with `owner = buyer`, `sold += 1` | `sold == max_supply` → `SoldOut` |
| 3 | `list_ticket(price)` | ticket owner | Sets `listed = true`, `ask_price = price` | **`price > face_price` → `PriceAboveFace`** · signer ≠ owner → `NotOwner` · `used` → `TicketUsed` · `price == 0` → `InvalidPrice` |
| 4 | `cancel_listing()` | ticket owner | Sets `listed = false`, `ask_price = 0` | signer ≠ owner → `NotOwner` |
| 5 | `buy_resale(max_price)` | buyer | **Atomically:** pays `ask_price` buyer → seller, sets `owner = buyer`, `listed = false`, `ask_price = 0` | not listed → `NotListed` · buyer == owner → `CannotBuyOwnTicket` · `used` → `TicketUsed` · seller account ≠ `ticket.owner` → `NotOwner` · `ask_price > max_price` (seller raised the price after the buyer saw it) → `PriceChanged` |
| 6 | `check_in()` | organizer | Sets `used = true`, `listed = false` | signer ≠ `event.organizer` → `NotOrganizer` · already used → `TicketUsed` |

**The cap (the one line this whole project is about):**
```rust
require!(price <= ctx.accounts.event.face_price, FaceValueError::PriceAboveFace);
```

**Belt and suspenders:** `buy_resale` re-checks `ticket.ask_price <= event.face_price` too, so the cap holds even if a future instruction forgets it.

### Errors

```rust
#[error_code]
pub enum FaceValueError {
    #[msg("Resale price can't be above face value")] PriceAboveFace,
    #[msg("This event is sold out")]                 SoldOut,
    #[msg("You don't own this ticket")]              NotOwner,
    #[msg("Only the organizer can do this")]         NotOrganizer,
    #[msg("This ticket isn't for sale")]             NotListed,
    #[msg("This ticket has already been used")]      TicketUsed,
    #[msg("You already own this ticket")]            CannotBuyOwnTicket,
    #[msg("Price must be greater than zero")]        InvalidPrice,
    #[msg("Event name must be 32 characters or fewer")] NameTooLong,
    #[msg("Max supply must be greater than zero")]   InvalidSupply,
    #[msg("The seller raised the price. Check the new price and try again")] PriceChanged,
}
```

### Payments
SOL transfers use `system_program::transfer` via CPI. The buyer is the signer, so no PDA signing is needed. The `seller` account in `buy_resale` must be `mut` and constrained to `seller.key() == ticket.owner`.

### Tests (Solana Playground, TypeScript)
1. Organizer creates event → Event account matches inputs
2. Wallet A buys ticket → A owns ticket, organizer balance +0.05 SOL, `sold == 1`
3. **A lists at 0.08 SOL → fails with `PriceAboveFace`** ← most important test
4. A lists at 0.05 SOL → `listed == true`
5. B names its own wallet as seller → `NotOwner`; B offers less than the ask → `PriceChanged`; B buys resale → B owns ticket, A balance +0.05 SOL, `listed == false`
6. A (no longer owner) tries to list → fails with `NotOwner`
7. A tries to check in → `NotOrganizer`; organizer checks in B's ticket → `used == true`; B tries to list → `TicketUsed`
8. Buy past `max_supply` → `SoldOut`

---

## 6. Frontend design

**Stack:** Next.js (App Router) · `@solana/wallet-adapter-react` + Phantom · `@coral-xyz/anchor` with the IDL exported from Solana Playground · devnet RPC.

**One page, three sections, stacked:**

1. **Event card:** "OSU Student Section — Saturday Game", face price **$50**, "X of Y sold", big **Buy ticket** button.
2. **My tickets:** each ticket the connected wallet owns: ticket #, status pill (Owned / Listed / Used). A price input, pre-filled with $50, and a **List for resale** button. A **Cancel listing** button if listed.
3. **Resale market:** all listed tickets for this event: ticket #, price, seller (short address), **Buy** button. Prices shown next to a "Face value: $50 · Max resale: $50" badge.

**Organizer view:** add `?organizer=1` to the URL to show a **Create event** form and a **Check in** button per ticket. Not linked anywhere, so the main page stays clean.

**The error moment must look intentional, not like a crash.** When `PriceAboveFace` comes back, show a clear red banner:
> 🚫 **Blocked by the ticket itself.** Resale price can't exceed face value ($50). *This rule is enforced onchain. No one can override it.*

Every successful transaction shows a toast with a **"View on Solana Explorer"** link (`?cluster=devnet`).

**Look and feel:** dark and premium, with one vibrant violet → pink → amber gradient (no OSU scarlet and gray), big buttons, readable from the back of the room (base font ≥18px on the demo laptop). No logins, no polish beyond that.

**Simple-to-use test (from the judging criteria):** a classmate should be able to buy and resell a ticket without us explaining anything.

---

## 7. Build plan: parts, owners, "done"

Instruction names and account fields in §5 are **frozen**. Both partners build against them, so nobody waits on anyone.

| Part | Owner | Build | Done when |
|---|---|---|---|
| **P1: Core program** | Partner A | `Event`, `Ticket`, `create_event`, `buy_ticket`, errors | Deployed to devnet in Playground; tests 1, 2, 8 pass |
| **P2: Resale + cap** | Partner A | `list_ticket`, `cancel_listing`, `buy_resale`, `check_in` | Tests 3–7 pass; IDL exported and committed to `/idl` |
| **P3: Frontend shell** | Partner B | Next.js app, wallet connect, Event card, Buy button | Connect Phantom on devnet → click Buy → ticket appears under My tickets → Explorer link works |
| **P4: Resale UI** | Partner B | My tickets list/cancel, Resale market, error banner | Two browser windows (two wallets): list at $80 → red banner; list at $50 → other wallet buys → ticket moves |
| **P5: Check-in + rehearsal** | Both | Organizer view, final polish, run the demo script 3× | Full demo script (§8) runs start to finish in under 90 seconds, twice in a row with no errors |

**Order:** P1 → P2 in parallel with P3 → P4 → P5. Until P2's IDL lands, Partner B can build P3 against P1's deployed program.

**Feature freeze: Wed 3 PM.** After that, only bug fixes and rehearsal.

### Prompt template (Joey's four parts, log every prompt in PROMPTS.md)

```
Here's our spec: [paste SPEC.md]

Build only this part: [e.g. "P2: list_ticket, cancel_listing, buy_resale, check_in"].
How it should look: [e.g. "Anchor program in Solana Playground, matching §5 exactly"].
Done when: [paste the "Done when" cell for that part].

Keep it simple and tell us exactly how to run it.
```
Each part gets 3–4 prompts: **build it → fix what broke → clean it up.** Don't ask for two parts in one prompt.

---

## 8. Demo script (90 seconds)

**Setup before the meeting:** two Chrome profiles side by side, each with Phantom in testnet mode on Solana Devnet. "Alex (seller)" on the left, "Jordan (buyer)" on the right. Both wallets pre-funded with ≥1 devnet SOL **tonight** (the faucet rate-limits). Event already created. Explorer tab open.

1. **(15s)** Alex clicks **Buy ticket** → pays $50 → ticket appears under My tickets. *"Alex got a student ticket at face value."*
2. **(20s)** Alex can't go anymore and tries to resell for **$80** → **red banner: blocked by the ticket itself.** *"On StubHub this would've listed. Here, the ticket refuses."* ← pause, let it land
3. **(15s)** Alex lists at **$50** → appears in Resale market.
4. **(20s)** Jordan clicks **Buy** → ticket moves to Jordan, Alex gets $50, all in one transaction. Click the Explorer link. *"Payment and ticket moved together. Neither side could get scammed."*
5. **(20s)** Organizer view → **Check in** Jordan's ticket → status: Used. *"At the gate it's marked used, so it can't be resold again."*

**Backup:** record a screen capture of the full script Wednesday afternoon. If devnet is down in the room, play it and say so.

## 9. Pitch outline (3 minutes, both partners speak)

| Time | Who | Content | Slide |
|---|---|---|---|
| 0:00–0:30 | A | Problem + who: OSU student, sold-out game, scalper wants $300 for a $50 ticket | 1. Problem |
| 0:30–1:00 | A | Idea + why blockchain: the cap is code, not policy; atomic payment + transfer | 2. How it works · 3. Why onchain |
| 1:00–2:30 | B | Live demo (§8) | — (live) |
| 2:30–3:00 | B | What's next with a full week (§11) | 4. Next |

Slide 5 (if needed): how we built it with AI (SPEC → parts → prompts log). Great for the "tell me about something you built" story.

## 10. Judge Q&A, prepared answers

- **"Can't they just take extra cash on Venmo on the side?"** Yes, and code can't stop money that moves off-chain. Two answers: (1) the platform never *helps* anyone scalp, unlike StubHub, which profits from it; (2) next step is a rotating QR at the gate signed by the owner's wallet, so handing over a ticket to a stranger you don't trust gets risky. We'd rather be honest about this limit.
- **"Why not just have Ticketmaster cap prices?"** Ticketmaster earns fees on resale, so it's not motivated to. And a cap on one company's site disappears the moment the ticket leaves it. Ours is a rule any org can issue tickets under.
- **"Why SOL and not dollars?"** Fastest to build for the demo. The real version uses USDC, so $50 always means $50.
- **"What if students don't have wallets?"** Email-based embedded wallets (e.g. Phantom's) mean no seed phrase. On the next-steps list.
- **"Who's the customer?"** Student orgs and campus venues issuing tickets. They want their events full of real fans, not scalper profits.

## 11. Out of scope (for Wednesday) → "What's next"

- USDC payments (dollar prices)
- Rotating QR code at the gate, signed by the owner's wallet
- Optional cap above face (e.g. face + 5% to cover the seller's fees)
- Organizer royalty: a small cut of each resale goes back to the student org
- Per-wallet purchase limits to slow bots
- Email sign-in / embedded wallets
- Multiple events and an event list page

## 12. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Devnet faucet rate-limits | Fund both demo wallets tonight via faucet.solana.com; Playground wallet can airdrop too |
| Devnet RPC slow in the room | Pre-load the page; backup screen recording |
| Phantom on wrong network | Checklist item before pitch: both wallets in testnet mode on Solana Devnet |
| Anchor error codes not parsing in the frontend | Fall back to matching the error message string `"Resale price can't be above face value"` |
| Running out of time | P1 + P2 + a bare P4 (list at $80 fails, list at $50 sells) **is** the demo. Check-in is the first thing to cut |

---

## 13. Repo layout

```
facevalue/
├── SPEC.md          ← this file
├── PROMPTS.md       ← every prompt we used, per part, with what broke
├── program/         ← Anchor program exported from Solana Playground
├── idl/facevalue.json
└── app/             ← Next.js frontend
```

**UBC rule:** code for UBC must be written Nov 13–20. If we take this to UBC, start a fresh repo on Nov 13 and rebuild from this SPEC. Don't copy code over.
