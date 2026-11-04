// FaceValue tests (SPEC §5). Paste into tests/facevalue.test.ts in Solana Playground,
// then click Test. Uses the Playground wallet as the organizer and funds two
// throwaway wallets (A and B) from it, so no faucet is needed.
// `pg`, `web3`, `anchor`, `BN` and `assert` are globals in Solana Playground.

describe("facevalue", () => {
  const program = pg.program;
  const organizer = pg.wallet;
  const conn = pg.connection;

  const FACE = new BN(0.05 * web3.LAMPORTS_PER_SOL); // 0.05 SOL, shown as "$50"
  const ABOVE = new BN(0.08 * web3.LAMPORTS_PER_SOL); // 0.08 SOL, shown as "$80"
  const eventId = new BN(Date.now()); // fresh event every run
  const MAX_SUPPLY = 2;

  const a = web3.Keypair.generate();
  const b = web3.Keypair.generate();

  const [eventPda] = web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("event"),
      organizer.publicKey.toBuffer(),
      eventId.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );
  const ticketPda = (id: number) =>
    web3.PublicKey.findProgramAddressSync(
      [Buffer.from("ticket"), eventPda.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 4)],
      program.programId
    )[0];

  const fund = async (to: web3.PublicKey, sol: number) => {
    const tx = new web3.Transaction().add(
      web3.SystemProgram.transfer({
        fromPubkey: organizer.publicKey,
        toPubkey: to,
        lamports: sol * web3.LAMPORTS_PER_SOL,
      })
    );
    await web3.sendAndConfirmTransaction(conn, tx, [organizer.keypair]);
  };

  const expectError = async (p: Promise<unknown>, name: string) => {
    try {
      await p;
    } catch (e: any) {
      const code = e?.error?.errorCode?.code ?? "";
      const text = code || String(e);
      assert.ok(text.includes(name), `expected ${name}, got: ${text}`);
      return;
    }
    assert.fail(`expected ${name}, but the transaction succeeded`);
  };

  const buy = (buyer: web3.Keypair, id: number) =>
    program.methods
      .buyTicket()
      .accountsStrict({
        event: eventPda,
        ticket: ticketPda(id),
        organizer: organizer.publicKey,
        buyer: buyer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();

  const list = (owner: web3.Keypair, price: BN) =>
    program.methods
      .listTicket(price)
      .accountsStrict({ event: eventPda, ticket: ticketPda(0), owner: owner.publicKey })
      .signers([owner])
      .rpc();

  before(async () => {
    await fund(a.publicKey, 0.2);
    await fund(b.publicKey, 0.2);
  });

  it("1. organizer creates an event", async () => {
    await program.methods
      .createEvent(eventId, "OSU Student Section", FACE, MAX_SUPPLY)
      .accountsStrict({
        event: eventPda,
        organizer: organizer.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();
    const ev = await program.account.event.fetch(eventPda);
    assert.ok(ev.organizer.equals(organizer.publicKey));
    assert.equal(ev.name, "OSU Student Section");
    assert.ok(ev.facePrice.eq(FACE));
    assert.equal(ev.maxSupply, MAX_SUPPLY);
    assert.equal(ev.sold, 0);
  });

  it("2. wallet A buys a ticket at face value", async () => {
    const before = await conn.getBalance(organizer.publicKey);
    await buy(a, 0);
    const after = await conn.getBalance(organizer.publicKey);
    const t = await program.account.ticket.fetch(ticketPda(0));
    assert.ok(t.owner.equals(a.publicKey));
    assert.equal(after - before, FACE.toNumber());
    assert.equal((await program.account.event.fetch(eventPda)).sold, 1);
  });

  it("3. A lists at 0.08 SOL ($80) -> PriceAboveFace", async () => {
    await expectError(list(a, ABOVE), "PriceAboveFace");
  });

  it("4. A lists at 0.05 SOL ($50) -> listed", async () => {
    await list(a, FACE);
    const t = await program.account.ticket.fetch(ticketPda(0));
    assert.equal(t.listed, true);
    assert.ok(t.askPrice.eq(FACE));
  });

  it("5. B buys the resale -> B owns it, A gets paid, all in one tx", async () => {
    const before = await conn.getBalance(a.publicKey);
    await program.methods
      .buyResale()
      .accountsStrict({
        event: eventPda,
        ticket: ticketPda(0),
        seller: a.publicKey,
        buyer: b.publicKey,
        systemProgram: web3.SystemProgram.programId,
      })
      .signers([b])
      .rpc();
    const after = await conn.getBalance(a.publicKey);
    const t = await program.account.ticket.fetch(ticketPda(0));
    assert.ok(t.owner.equals(b.publicKey));
    assert.equal(t.listed, false);
    assert.equal(after - before, FACE.toNumber());
  });

  it("6. A (no longer owner) tries to list -> NotOwner", async () => {
    await expectError(list(a, FACE), "NotOwner");
  });

  it("7. organizer checks in B's ticket; B tries to list -> TicketUsed", async () => {
    await program.methods
      .checkIn()
      .accountsStrict({ event: eventPda, ticket: ticketPda(0), organizer: organizer.publicKey })
      .rpc();
    const t = await program.account.ticket.fetch(ticketPda(0));
    assert.equal(t.used, true);
    await expectError(list(b, FACE), "TicketUsed");
  });

  it("8. buying past max_supply -> SoldOut", async () => {
    await buy(b, 1); // second (last) ticket
    await expectError(buy(b, 2), "SoldOut");
  });
});
