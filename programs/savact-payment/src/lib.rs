use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("NEku86HDWM6YZoHZG2oBX7rei5LX8Kbq8b4bJXUW4Zm");

const PAYMENT_SEED: &[u8] = b"payment";

#[program]
pub mod savact_payment {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, system: Pubkey) -> Result<()> {
        ctx.accounts.manager.authority = ctx.accounts.authority.key();
        ctx.accounts.manager.payment_count = 0;
        ctx.accounts.manager.system = system;
        Ok(())
    }

    pub fn update_system(ctx: Context<UpdateSystem>, new_system: Pubkey) -> Result<()> {
        require!(
            new_system != Pubkey::default(),
            TimedPaymentError::InvalidSystem
        );
        ctx.accounts.manager.system = new_system;
        Ok(())
    }

    pub fn create_payment(ctx: Context<CreatePayment>, amount: u64, expiry: i64) -> Result<u64> {
        let clock = Clock::get()?;
        require!(
            expiry > clock.unix_timestamp,
            TimedPaymentError::TimeLimitAlreadyExpired
        );

        let payment = &mut ctx.accounts.payment;
        payment.from = ctx.accounts.from.key();
        payment.to = ctx.accounts.to.key();
        payment.mint = ctx.accounts.mint.key();
        payment.amount = amount;
        payment.expiry = expiry;
        payment.status = PaymentStatus::Active as u8;
        payment.payment_id = ctx.accounts.manager.payment_count;

        // Transfer tokens from sender "from" to deposit account
        let cpi_accounts = Transfer {
            from: ctx.accounts.from_token_acc.to_account_info(),
            to: ctx.accounts.deposit_token_acc.to_account_info(),
            authority: ctx.accounts.from.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // Increment the payment count
        ctx.accounts.manager.payment_count += 1;

        Ok(payment.payment_id)
    }

    pub fn invalidate(ctx: Context<Invalidate>) -> Result<()> {
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < ctx.accounts.payment.expiry,
            TimedPaymentError::TimeLimitAlreadyExpired
        );

        ctx.accounts.payment.status = PaymentStatus::Invalidated as u8;

        payout_tokens(
            &ctx.accounts.payment,
            &ctx.accounts.deposit_token_acc,
            &ctx.accounts.system_token_acc,
            &ctx.accounts.token_program,
            &ctx.accounts.manager,
            ctx.bumps.payment,
        )?;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= ctx.accounts.payment.expiry,
            TimedPaymentError::TimeLimmitNotExpired
        );

        ctx.accounts.payment.status = PaymentStatus::Withdrawn as u8;

        payout_tokens(
            &ctx.accounts.payment,
            &ctx.accounts.deposit_token_acc,
            &ctx.accounts.to_token_acc,
            &ctx.accounts.token_program,
            &ctx.accounts.manager,
            ctx.bumps.payment,
        )?;

        Ok(())
    }

    pub fn reject(ctx: Context<Reject>) -> Result<()> {
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < ctx.accounts.payment.expiry,
            TimedPaymentError::TimeLimitAlreadyExpired
        );

        ctx.accounts.payment.status = PaymentStatus::Rejected as u8;

        payout_tokens(
            &ctx.accounts.payment,
            &ctx.accounts.deposit_token_acc,
            &ctx.accounts.from_token_acc,
            &ctx.accounts.token_program,
            &ctx.accounts.manager,
            ctx.bumps.payment,
        )?;

        Ok(())
    }

    pub fn extend(ctx: Context<Extend>, new_expiry: i64) -> Result<()> {
        let clock = Clock::get()?;
        require!(
            new_expiry > ctx.accounts.payment.expiry,
            TimedPaymentError::InvalidNewExpiry
        );
        require!(
            new_expiry > clock.unix_timestamp,
            TimedPaymentError::TimeLimitAlreadyExpired
        );

        ctx.accounts.payment.expiry = new_expiry;

        Ok(())
    }

    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        ctx.accounts.payment.status = PaymentStatus::Finalized as u8;

        payout_tokens(
            &ctx.accounts.payment,
            &ctx.accounts.deposit_token_acc,
            &ctx.accounts.to_token_acc,
            &ctx.accounts.token_program,
            &ctx.accounts.manager,
            ctx.bumps.payment,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8 + 32)]
    pub manager: Account<'info, PaymentManager>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateSystem<'info> {
    #[account(mut, has_one = authority)]
    pub manager: Account<'info, PaymentManager>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(amount: u64, expiry: i64)]
pub struct CreatePayment<'info> {
    #[account(mut)]
    pub manager: Account<'info, PaymentManager>,
    #[account(
        init,
        payer = from,
        space = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 8,
        seeds = [PAYMENT_SEED, manager.key().as_ref(), &manager.payment_count.to_le_bytes()],
        bump
    )]
    pub payment: Account<'info, Payment>,
    #[account(mut)]
    pub from: Signer<'info>,
    pub to: AccountInfo<'info>,
    pub mint: Account<'info, token::Mint>,
    #[account(
        mut,
        constraint = from_token_acc.owner == from.key(),
        constraint = from_token_acc.mint == mint.key()
    )]
    pub from_token_acc: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = from,
        seeds = [b"deposit", payment.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = payment,
    )]
    pub deposit_token_acc: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Invalidate<'info> {
    pub manager: Account<'info, PaymentManager>,
    #[account(
        mut,
        seeds = [PAYMENT_SEED, manager.key().as_ref(), &payment.payment_id.to_le_bytes()],
        bump,
        constraint = payment.status == PaymentStatus::Active as u8,
        has_one = from,
        has_one = mint,
    )]
    pub payment: Account<'info, Payment>,
    pub from: Signer<'info>,
    pub mint: Account<'info, token::Mint>,
    #[account(
        mut,
        constraint = deposit_token_acc.mint == mint.key(),
        constraint = deposit_token_acc.owner == payment.key(),
    )]
    pub deposit_token_acc: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = system_token_acc.owner == manager.system,
        constraint = system_token_acc.mint == mint.key()
    )]
    pub system_token_acc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub manager: Account<'info, PaymentManager>,
    #[account(
        mut,
        seeds = [PAYMENT_SEED, manager.key().as_ref(), &payment.payment_id.to_le_bytes()],
        bump,
        constraint = payment.status == PaymentStatus::Active as u8,
        has_one = to,
        has_one = mint,
    )]
    pub payment: Account<'info, Payment>,
    pub to: Signer<'info>,
    pub mint: Account<'info, token::Mint>,
    #[account(
        mut,
        constraint = deposit_token_acc.mint == mint.key(),
        constraint = deposit_token_acc.owner == payment.key(),
    )]
    pub deposit_token_acc: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = to_token_acc.owner == to.key(),
        constraint = to_token_acc.mint == mint.key()
    )]
    pub to_token_acc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Reject<'info> {
    pub manager: Account<'info, PaymentManager>,
    #[account(
        mut,
        seeds = [PAYMENT_SEED, manager.key().as_ref(), &payment.payment_id.to_le_bytes()],
        bump,
        constraint = payment.status == PaymentStatus::Active as u8,
        has_one = from,
        has_one = to,
        has_one = mint,
    )]
    pub payment: Account<'info, Payment>,
    pub from: AccountInfo<'info>,
    pub to: Signer<'info>,
    pub mint: Account<'info, token::Mint>,
    #[account(
        mut,
        constraint = deposit_token_acc.mint == mint.key(),
        constraint = deposit_token_acc.owner == payment.key(),
    )]
    pub deposit_token_acc: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = from_token_acc.owner == from.key(),
        constraint = from_token_acc.mint == mint.key()
    )]
    pub from_token_acc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Extend<'info> {
    pub manager: Account<'info, PaymentManager>,
    #[account(
        mut,
        seeds = [PAYMENT_SEED, manager.key().as_ref(), &payment.payment_id.to_le_bytes()],
        bump,
        constraint = payment.status == PaymentStatus::Active as u8,
        has_one = to,
    )]
    pub payment: Account<'info, Payment>,
    pub to: Signer<'info>,
}

#[derive(Accounts)]
pub struct Finalize<'info> {
    pub manager: Account<'info, PaymentManager>,
    #[account(
        mut,
        seeds = [PAYMENT_SEED, manager.key().as_ref(), &payment.payment_id.to_le_bytes()],
        bump,
        constraint = payment.status == PaymentStatus::Active as u8,
        has_one = from,
        has_one = to,
        has_one = mint,
    )]
    pub payment: Account<'info, Payment>,
    pub from: Signer<'info>,
    pub to: AccountInfo<'info>,
    pub mint: Account<'info, token::Mint>,
    #[account(
        mut,
        constraint = deposit_token_acc.mint == mint.key(),
        constraint = deposit_token_acc.owner == payment.key(),
    )]
    pub deposit_token_acc: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = to_token_acc.owner == to.key(),
        constraint = to_token_acc.mint == mint.key()
    )]
    pub to_token_acc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct PaymentManager {
    pub authority: Pubkey,
    pub payment_count: u64,
    pub system: Pubkey,
}

#[account]
pub struct Payment {
    pub from: Pubkey,
    pub to: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub expiry: i64,
    pub status: u8,
    pub payment_id: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PaymentStatus {
    Active = 0,
    Invalidated = 1,
    Withdrawn = 2,
    Rejected = 3,
    Finalized = 4,
}

#[error_code]
pub enum TimedPaymentError {
    #[msg("Time limit is already expired")]
    TimeLimitAlreadyExpired,
    #[msg("Time limit is not expired yet")]
    TimeLimmitNotExpired,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid new expiry time")]
    InvalidNewExpiry,
    #[msg("Invalid system address")]
    InvalidSystem,
}

fn payout_tokens<'info>(
    payment: &Account<'info, Payment>,
    deposit_account: &Account<'info, TokenAccount>,
    recipient: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    manager: &Account<'info, PaymentManager>,
    bump: u8,
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: deposit_account.to_account_info(),
        to: recipient.to_account_info(),
        authority: payment.to_account_info(),
    };
    let cpi_program = token_program.to_account_info();
    let seeds = &[
        PAYMENT_SEED,
        manager.to_account_info().key.as_ref(),
        &payment.payment_id.to_le_bytes(),
        &[bump],
    ];
    let signer = &[&seeds[..]];
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, payment.amount)?;
    Ok(())
}
