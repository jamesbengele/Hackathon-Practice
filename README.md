# FaceValue

Student tickets that can never be resold above face value. See `SPEC.md` for the full plan.

```
Hackathon Practice/
├── SPEC.md
├── PROMPTS.md
├── program/src/lib.rs           ← Anchor program (paste into Solana Playground)
├── program/tests/facevalue.test.ts  ← the 8 tests from SPEC §5 (paste into Playground)
├── idl/facevalue.json           ← IDL generated from lib.rs
└── app/                         ← Next.js frontend
```

## 1. Deploy the program (Solana Playground, ~5 min)

1. Open https://beta.solpg.io, click **Create a new project**, pick **Anchor (Rust)**, name it `facevalue`.
2. Replace everything in `src/lib.rs` with `program/src/lib.rs` from this folder.
3. Bottom-left: make sure the cluster is **devnet** and the Playground wallet has SOL
   (run `solana airdrop 2` in the Playground terminal, or use https://faucet.solana.com).
   Deploying needs about 2–3 SOL.
4. Click **Build**, then **Deploy**. Copy the **Program ID** from the Build & Deploy tab.
5. Tests: in the Playground file explorer, replace the test file under `tests/` with
   `program/tests/facevalue.test.ts`, then click **Test**. All 8 should pass.
   (The tests fund two throwaway wallets with 0.2 SOL each from the Playground wallet.)

## 2. Run the frontend

Needs Node.js 20 or newer (https://nodejs.org, LTS installer).

```powershell
cd "C:\Users\James b\Documents\Hackathon Practice\app"
notepad lib\config.ts       # paste the Program ID between the quotes, save
npm install
npm run dev
```

Open http://localhost:3000. The frontend ships with its own IDL (`app/lib/facevalue.json`),
so you don't need to export anything from Playground.

## 3. Set up the demo (SPEC §8)

1. Phantom: Settings → Developer settings → **Testnet mode** on, network **Solana Devnet**.
   Do this in both Chrome profiles (Alex and Jordan). Fund each with ≥1 devnet SOL tonight.
2. Create the event: open http://localhost:3000/?organizer=1, connect the **organizer** wallet,
   click **Create event** (defaults: $50 face, 100 tickets). The organizer receives every
   face-value sale, so use a third wallet if you want Alex's balance change to be clean.
3. The main page always shows the newest event. To pin a specific one, add `?event=<event address>`
   (shown at the bottom of the organizer view).

Demo flow: Alex **Buy ticket** → list at **$80** → red "Blocked by the ticket itself" banner →
list at **$50** → Jordan **Buy** in the Resale market → `?organizer=1` → **Check in**.

## How it works

- Before the wallet pops up, every action is **simulated against the deployed program on devnet**.
  If the program rejects it (like listing at $80), the app shows the error straight away and
  Phantom never asks you to sign a transaction that would fail. The rejection comes from the
  program's `require!(price <= face_price)` line, not from any check in the frontend.
- The page refreshes every 4 seconds so two browser windows stay in sync.
- Display rate: 1 SOL = $1,000 (demo only), so $50 = 0.05 SOL.

## If you change the program

Account fields and instruction names are frozen in SPEC §5. If you do change them, regenerate
the IDL and copy it to both `idl/facevalue.json` and `app/lib/facevalue.json`. The frontend uses
`@coral-xyz/anchor` 0.30.1, which needs the **new** IDL format (with `discriminator` fields).
