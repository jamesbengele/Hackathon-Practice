# FaceValue — Pitch (3 min + 1 min Q&A)

**Track:** Consumer Apps · **Chain:** Solana devnet · **When:** Wed Nov 4, 7 PM, Busch Honor Room
**Speakers:** Partner A (problem + why onchain), Partner B (live demo + what's next)

> **The line the judges should leave with:** *Try to resell a $50 ticket for $80 and the blockchain rejects it. List it at $50 and it sells instantly.*

---

## 0:00–0:30 · The problem (Partner A) · Slide 1 "Problem"

> "Raise your hand if you've ever paid way too much for a student ticket, or just stayed home.
>
> It's the Saturday game. Student section, sold out in minutes. Then the same tickets show up in the group chat and on StubHub for **$300**. Face value was **$50**.
>
> The people buying at face value aren't the fans. They're scalpers and bots. And the student org that sold the ticket can't do anything, because once that ticket is a PDF, a screenshot or a transferred account, their 'no markup' rule is gone."

**Slide 1:** big "$50 → $300", a screenshot-style mock of a group-chat resale post, one line: *"The cap lives in a terms-of-service page. The ticket ignores it."*

## 0:30–1:00 · The idea + why it needs a blockchain (Partner A) · Slides 2–3

> "FaceValue moves the rule **into the ticket itself**.
>
> Every ticket is an account owned by our Solana program. The only way to change who owns it is our resale instruction, and that instruction has one line in it: *price must be less than or equal to face value.* Not a policy. Code. Nobody can override it, including us.
>
> Two more things fall out of that for free. Payment and transfer happen in **one atomic transaction**, so the buyer can't get a fake ticket and the seller can't get stiffed. And ownership is public, so the gate can check it."

**Slide 2 "How it works":** Buy at face → List (≤ face only) → Buy resale (pay + transfer, one tx) → Check in at gate (marked used).

**Slide 3 "Why onchain":**

| A normal app | FaceValue |
|---|---|
| The cap is a policy the company can change | The cap is code. No one can sell above face |
| Only works on one company's site | Any student org or venue can issue tickets under the same rule |
| Ownership is a private database row | Ownership is public and verifiable at the gate |
| Pay and transfer are separate, scams happen in between | Pay and transfer are one atomic transaction |

**Hand-off line:** *"Don't take my word for it. Here's what happens when a scalper tries."*

## 1:00–2:30 · Live demo (Partner B)

Run [`DEMO.md`](./DEMO.md) exactly. It's timed at ~90 seconds. The pause after the red banner is the most important beat of the whole pitch.

## 2:30–3:00 · What's next (Partner B) · Slide 4 "Next"

> "With one more week:
> - **USDC instead of SOL**, so $50 always means $50.
> - **A rotating QR code at the gate**, signed by the owner's wallet, so passing a ticket to a stranger off-platform gets risky.
> - **Organizer royalties**: a small cut of each resale goes back to the student org.
> - **Email sign-in** with embedded wallets, so no student ever sees a seed phrase.
> - Per-wallet purchase limits to slow bots.
>
> Student orgs want their sections full of real fans. FaceValue makes the fair price the only price. Thank you."

**Slide 5 (only if asked how we built it):** SPEC.md → 5 parts with "done when" checks → every AI prompt logged in PROMPTS.md (build it → fix what broke → clean it up).

---

## Judge Q&A (1 min) — prepared answers

Keep each answer to two sentences. Partner A takes "why" questions, Partner B takes "how" questions.

| If they ask… | Say… |
|---|---|
| **"Can't they just take extra cash on Venmo?"** | "Yes, and no code can stop money that moves off-chain. But our platform never *helps* anyone scalp the way StubHub profits from it, and the rotating gate QR makes handing a ticket to a stranger you don't trust risky." |
| **"Why not just have Ticketmaster cap prices?"** | "Ticketmaster earns fees on resale, so it's not motivated to. And a cap on one site disappears the moment the ticket leaves it. Ours travels with the ticket." |
| **"Why SOL and not dollars?"** | "Fastest path for the demo. The real version uses USDC, so prices are actually in dollars." |
| **"What if students don't have wallets?"** | "Email-based embedded wallets mean no seed phrase. It's on the next-steps list." |
| **"Who's the customer?"** | "Student orgs and campus venues issuing tickets. They want real fans in the seats, not scalper profits." |
| **"Couldn't someone just transfer the NFT on another marketplace?"** | "That's exactly why it's not a normal NFT. The ticket is an account our program owns, and the only instruction that changes its owner enforces the cap." |
| **"What stops a bot from buying them all at face?"** | "Today, nothing beyond supply. Per-wallet limits and verified student sign-in are next. But even if a bot buys, it can't profit, so the incentive is gone." |
| **"Can the cap be bypassed by a future update?"** | "The resale instruction re-checks the cap itself, so even a new listing path can't sneak a higher price through. For production we'd make the program immutable or put upgrades behind the student orgs." |

## Speaker reminders

- Say **"the ticket refuses"**, not "the app shows an error." The rejection comes from the program on devnet, not the frontend.
- Prices are shown as dollars at a demo rate (1 SOL = $1,000, so $50 = 0.05 devnet SOL). If anyone asks, say so plainly.
- Be honest about limits (Venmo on the side). Judges reward it.
