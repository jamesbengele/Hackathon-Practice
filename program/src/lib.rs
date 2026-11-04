// FaceValue: student tickets that can never be resold above face value.
// Paste this whole file into src/lib.rs in Solana Playground (beta.solpg.io).
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

// Solana Playground fills this in for you when you click Build.
declare_id!("9gCTdqdJtobM3NxVt262EyfvcrAKmqy7NSaSwpRLRkg2");

#[program]
pub mod facevalue {
    use super::*;

    /// 1. Organizer creates an event.
    pub fn create_event(
        ctx: Context<CreateEvent>,
        event_id: u64,
        name: String,
        face_price: u64,
        max_supply: u32,
    ) -> Result<()> {
        require!(name.len() <= 32, FaceValueError::NameTooLong);
        require!(face_price > 0, FaceValueError::InvalidPrice);
        require!(max_supply > 0, FaceValueError::InvalidSupply);

        let event = &mut ctx.accounts.event;
        event.organizer = ctx.accounts.organizer.key();
        event.event_id = event_id;
        event.name = name;
        event.face_price = face_price;
        event.max_supply = max_supply;
        event.sold = 0;
        event.bump = ctx.bumps.event;
        Ok(())
    }

    /// 2. Buyer pays face price to the organizer and gets a new ticket.
    pub fn buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
        let event = &mut ctx.accounts.event;
        require!(event.sold < event.max_supply, FaceValueError::SoldOut);

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.organizer.to_account_info(),
                },
            ),
            event.face_price,
        )?;

        let ticket = &mut ctx.accounts.ticket;
        ticket.event = event.key();
        ticket.ticket_id = event.sold;
        ticket.owner = ctx.accounts.buyer.key();
        ticket.listed = false;
        ticket.ask_price = 0;
        ticket.used = false;
        ticket.bump = ctx.bumps.ticket;

        event.sold += 1;
        Ok(())
    }

    /// 3. Owner lists a ticket for resale. THE CAP LIVES HERE.
    pub fn list_ticket(ctx: Context<ListTicket>, price: u64) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        require_keys_eq!(ctx.accounts.owner.key(), ticket.owner, FaceValueError::NotOwner);
        require!(!ticket.used, FaceValueError::TicketUsed);
        require!(price > 0, FaceValueError::InvalidPrice);
        // The one line this whole project is about:
        require!(price <= ctx.accounts.event.face_price, FaceValueError::PriceAboveFace);

        ticket.listed = true;
        ticket.ask_price = price;
        Ok(())
    }

    /// 4. Owner takes a ticket off the market.
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        require_keys_eq!(ctx.accounts.owner.key(), ticket.owner, FaceValueError::NotOwner);
        ticket.listed = false;
        ticket.ask_price = 0;
        Ok(())
    }

    /// 5. Buyer pays the seller and becomes the owner, in one atomic transaction.
    pub fn buy_resale(ctx: Context<BuyResale>) -> Result<()> {
        let ticket = &mut ctx.accounts.ticket;
        require!(ticket.listed, FaceValueError::NotListed);
        require!(!ticket.used, FaceValueError::TicketUsed);
        require_keys_neq!(
            ctx.accounts.buyer.key(),
            ticket.owner,
            FaceValueError::CannotBuyOwnTicket
        );
        require_keys_eq!(ctx.accounts.seller.key(), ticket.owner, FaceValueError::NotOwner);
        // Belt and suspenders: the cap holds even if a future instruction forgets it.
        require!(
            ticket.ask_price <= ctx.accounts.event.face_price,
            FaceValueError::PriceAboveFace
        );

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
            ),
            ticket.ask_price,
        )?;

        ticket.owner = ctx.accounts.buyer.key();
        ticket.listed = false;
        ticket.ask_price = 0;
        Ok(())
    }

    /// 6. Organizer marks a ticket as used at the gate.
    pub fn check_in(ctx: Context<CheckIn>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.organizer.key(),
            ctx.accounts.event.organizer,
            FaceValueError::NotOrganizer
        );
        let ticket = &mut ctx.accounts.ticket;
        require!(!ticket.used, FaceValueError::TicketUsed);
        ticket.used = true;
        ticket.listed = false;
        ticket.ask_price = 0;
        Ok(())
    }
}

// ---------- Accounts ----------

#[account]
#[derive(InitSpace)]
pub struct Event {
    pub organizer: Pubkey,
    pub event_id: u64,
    #[max_len(32)]
    pub name: String,
    pub face_price: u64, // lamports
    pub max_supply: u32,
    pub sold: u32, // also used as the next ticket_id
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub event: Pubkey,
    pub ticket_id: u32,
    pub owner: Pubkey,
    pub listed: bool,
    pub ask_price: u64, // lamports, 0 when not listed
    pub used: bool,
    pub bump: u8,
}

// ---------- Instruction contexts ----------

#[derive(Accounts)]
#[instruction(event_id: u64)]
pub struct CreateEvent<'info> {
    #[account(
        init,
        payer = organizer,
        space = 8 + Event::INIT_SPACE,
        seeds = [b"event", organizer.key().as_ref(), &event_id.to_le_bytes()],
        bump
    )]
    pub event: Account<'info, Event>,
    #[account(mut)]
    pub organizer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(
        mut,
        seeds = [b"event", event.organizer.as_ref(), &event.event_id.to_le_bytes()],
        bump = event.bump,
        constraint = event.sold < event.max_supply @ FaceValueError::SoldOut
    )]
    pub event: Account<'info, Event>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Ticket::INIT_SPACE,
        seeds = [b"ticket", event.key().as_ref(), &event.sold.to_le_bytes()],
        bump
    )]
    pub ticket: Account<'info, Ticket>,
    /// CHECK: receives the face price; must be the event's organizer.
    #[account(mut, address = event.organizer @ FaceValueError::NotOrganizer)]
    pub organizer: UncheckedAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ListTicket<'info> {
    pub event: Account<'info, Event>,
    #[account(mut, has_one = event)]
    pub ticket: Account<'info, Ticket>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub ticket: Account<'info, Ticket>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyResale<'info> {
    pub event: Account<'info, Event>,
    #[account(mut, has_one = event)]
    pub ticket: Account<'info, Ticket>,
    /// CHECK: receives the ask price; checked against ticket.owner in the handler.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CheckIn<'info> {
    pub event: Account<'info, Event>,
    #[account(mut, has_one = event)]
    pub ticket: Account<'info, Ticket>,
    pub organizer: Signer<'info>,
}

// ---------- Errors ----------
// Codes 6000-6007 are frozen (SPEC §5). New errors only go at the end.

#[error_code]
pub enum FaceValueError {
    #[msg("Resale price can't be above face value")]
    PriceAboveFace,
    #[msg("This event is sold out")]
    SoldOut,
    #[msg("You don't own this ticket")]
    NotOwner,
    #[msg("Only the organizer can do this")]
    NotOrganizer,
    #[msg("This ticket isn't for sale")]
    NotListed,
    #[msg("This ticket has already been used")]
    TicketUsed,
    #[msg("You already own this ticket")]
    CannotBuyOwnTicket,
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("Event name must be 32 characters or fewer")]
    NameTooLong,
    #[msg("Max supply must be greater than zero")]
    InvalidSupply,
}
