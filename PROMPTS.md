# PROMPTS.md

Every prompt we used, per part, with what broke.

## P1–P5 (first full build)

**Prompt:** "Read the spec.md file and create the app inside C:\Users\James b\Documents\Hackathon Practice"

**What came out:** Anchor program (`program/src/lib.rs`), the 8 tests from §5, the IDL, and the
Next.js frontend with the event card, My tickets, Resale market, red PriceAboveFace banner,
Explorer toasts and the `?organizer=1` view.

**What broke / notes:**
- Added two errors at the end of the enum (`NameTooLong`, `InvalidSupply`) for the `create_event`
  checks the spec lists. Codes 6000–6007 are unchanged.
- Duplicate copies of the wallet-adapter React package broke the wallet context; fixed by pinning versions.
- Transaction confirmation polls instead of using websockets, in case venue Wi-Fi blocks them.
