use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Burn, Token, TokenAccount, Transfer};

declare_id!("AeTHrGATeXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

// ─── Constants ────────────────────────────────────────────────────────────────
pub const VAULT_SEED:       &[u8] = b"vault";
pub const BRIDGE_SEED:      &[u8] = b"bridge";
pub const MINT_AUTH_SEED:   &[u8] = b"mint_auth";
pub const NONCE_SEED:       &[u8] = b"nonce";
pub const WRAPPED_MINT_SEED: &[u8] = b"wrapped";
pub const MAX_FEE_BPS:      u16   = 1000; // 10 %
pub const SOLANA_CHAIN_ID:  u64   = 101;  // Solana Devnet chain identifier

// ─── Program ──────────────────────────────────────────────────────────────────
#[program]
pub mod aether_gate {
    use super::*;

    // ── Admin: initialize bridge state ────────────────────────────────────────
    pub fn initialize(
        ctx: Context<Initialize>,
        relayer:       Pubkey,
        fee_recipient: Pubkey,
        fee_bps:       u16,
    ) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, BridgeError::FeeTooHigh);
        let bridge = &mut ctx.accounts.bridge_state;
        bridge.admin         = ctx.accounts.admin.key();
        bridge.relayer       = relayer;
        bridge.fee_recipient = fee_recipient;
        bridge.fee_bps       = fee_bps;
        bridge.paused        = false;
        bridge.bump          = ctx.bumps.bridge_state;
        emit!(BridgeInitialized {
            admin: bridge.admin,
            relayer,
            fee_bps,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  lock_native — Lock SPL token into PDA vault → relayer mints on EVM
    // ─────────────────────────────────────────────────────────────────────────
    pub fn lock_native(
        ctx: Context<LockNative>,
        amount:         u64,
        dest_chain_id:  u64,
        dest_recipient: [u8; 32], // EVM address encoded as bytes32
        bridge_nonce:   [u8; 32],
    ) -> Result<()> {
        let bridge = &ctx.accounts.bridge_state;
        require!(!bridge.paused,  BridgeError::Paused);
        require!(amount > 0,      BridgeError::AmountZero);

        // Verify nonce not used
        let nonce_acc = &ctx.accounts.nonce_account;
        require!(!nonce_acc.used, BridgeError::NonceAlreadyUsed);

        let fee     = compute_fee(amount, bridge.fee_bps);
        let net     = amount.checked_sub(fee).unwrap();

        // Transfer amount from user → vault PDA
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.user_token_account.to_account_info(),
                to:        ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        // Transfer fee portion to fee_recipient immediately
        if fee > 0 {
            let seeds = &[VAULT_SEED, ctx.accounts.mint.key().as_ref(), &[ctx.bumps.vault_authority]];
            let signer = &[&seeds[..]];
            let fee_cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.vault_token_account.to_account_info(),
                    to:        ctx.accounts.fee_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer,
            );
            token::transfer(fee_cpi, fee)?;
        }

        // Mark nonce
        let nonce_acc = &mut ctx.accounts.nonce_account;
        nonce_acc.used = true;
        nonce_acc.bump = ctx.bumps.nonce_account;

        emit!(Locked {
            sender:         ctx.accounts.user.key(),
            mint:           ctx.accounts.mint.key(),
            amount:         net,
            fee,
            dest_chain_id,
            dest_recipient,
            bridge_nonce,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  unlock_native — Relayer releases locked SPL tokens to recipient
    //                  (after burn on EVM is verified)
    // ─────────────────────────────────────────────────────────────────────────
    pub fn unlock_native(
        ctx: Context<UnlockNative>,
        amount:          u64,
        bridge_nonce:    [u8; 32],
        origin_chain_id: u64,
    ) -> Result<()> {
        let bridge = &ctx.accounts.bridge_state;
        require!(!bridge.paused, BridgeError::Paused);
        require!(amount > 0,     BridgeError::AmountZero);
        require!(
            ctx.accounts.relayer.key() == bridge.relayer,
            BridgeError::Unauthorized
        );

        let nonce_acc = &ctx.accounts.nonce_account;
        require!(!nonce_acc.used, BridgeError::NonceAlreadyUsed);

        // Release from vault
        let mint_key = ctx.accounts.mint.key();
        let seeds    = &[VAULT_SEED, mint_key.as_ref(), &[ctx.bumps.vault_authority]];
        let signer   = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.vault_token_account.to_account_info(),
                to:        ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        let nonce_acc = &mut ctx.accounts.nonce_account;
        nonce_acc.used = true;
        nonce_acc.bump = ctx.bumps.nonce_account;

        emit!(Unlocked {
            bridge_nonce,
            recipient:       ctx.accounts.recipient.key(),
            mint:            ctx.accounts.mint.key(),
            amount,
            origin_chain_id,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  mint_wrapped — Relayer mints a wrapped SPL token representing an EVM asset
    //                 (after lock on EVM is verified)
    // ─────────────────────────────────────────────────────────────────────────
    pub fn mint_wrapped(
        ctx: Context<MintWrapped>,
        amount:          u64,
        bridge_nonce:    [u8; 32],
        origin_chain_id: u64,
    ) -> Result<()> {
        let bridge = &ctx.accounts.bridge_state;
        require!(!bridge.paused, BridgeError::Paused);
        require!(amount > 0,     BridgeError::AmountZero);
        require!(
            ctx.accounts.relayer.key() == bridge.relayer,
            BridgeError::Unauthorized
        );

        let nonce_acc = &ctx.accounts.nonce_account;
        require!(!nonce_acc.used, BridgeError::NonceAlreadyUsed);

        // Mint via mint_authority PDA
        let mint_key = ctx.accounts.wrapped_mint.key();
        let seeds    = &[MINT_AUTH_SEED, mint_key.as_ref(), &[ctx.bumps.mint_authority]];
        let signer   = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint:      ctx.accounts.wrapped_mint.to_account_info(),
                to:        ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            signer,
        );
        token::mint_to(cpi_ctx, amount)?;

        let nonce_acc = &mut ctx.accounts.nonce_account;
        nonce_acc.used = true;
        nonce_acc.bump = ctx.bumps.nonce_account;

        emit!(WrappedMinted {
            bridge_nonce,
            recipient:       ctx.accounts.recipient.key(),
            wrapped_mint:    ctx.accounts.wrapped_mint.key(),
            amount,
            origin_chain_id,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  burn_wrapped — User burns wrapped SPL token → relayer unlocks on EVM
    // ─────────────────────────────────────────────────────────────────────────
    pub fn burn_wrapped(
        ctx: Context<BurnWrapped>,
        amount:         u64,
        dest_chain_id:  u64,
        dest_recipient: [u8; 32], // EVM address
        bridge_nonce:   [u8; 32],
    ) -> Result<()> {
        let bridge = &ctx.accounts.bridge_state;
        require!(!bridge.paused, BridgeError::Paused);
        require!(amount > 0,     BridgeError::AmountZero);

        let nonce_acc = &ctx.accounts.nonce_account;
        require!(!nonce_acc.used, BridgeError::NonceAlreadyUsed);

        let fee = compute_fee(amount, bridge.fee_bps);
        let net = amount.checked_sub(fee).unwrap();

        // Burn net from user
        let burn_cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint:      ctx.accounts.wrapped_mint.to_account_info(),
                from:      ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::burn(burn_cpi, amount)?;

        // Mint fee to fee_recipient (stays as wrapped)
        if fee > 0 {
            let mint_key = ctx.accounts.wrapped_mint.key();
            let seeds    = &[MINT_AUTH_SEED, mint_key.as_ref(), &[ctx.bumps.mint_authority]];
            let signer   = &[&seeds[..]];

            let fee_cpi = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint:      ctx.accounts.wrapped_mint.to_account_info(),
                    to:        ctx.accounts.fee_token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                signer,
            );
            token::mint_to(fee_cpi, fee)?;
        }

        let nonce_acc = &mut ctx.accounts.nonce_account;
        nonce_acc.used = true;
        nonce_acc.bump = ctx.bumps.nonce_account;

        emit!(Burned {
            sender:         ctx.accounts.user.key(),
            wrapped_mint:   ctx.accounts.wrapped_mint.key(),
            amount:         net,
            fee,
            dest_chain_id,
            dest_recipient,
            bridge_nonce,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  set_fee — Admin updates fee_bps and fee_recipient
    // ─────────────────────────────────────────────────────────────────────────
    pub fn set_fee(
        ctx: Context<SetFee>,
        new_fee_bps: u16,
        new_fee_recipient: Pubkey,
    ) -> Result<()> {
        require!(new_fee_bps <= MAX_FEE_BPS, BridgeError::FeeTooHigh);
        let bridge = &mut ctx.accounts.bridge_state;
        require!(ctx.accounts.admin.key() == bridge.admin, BridgeError::UnauthorizedAdmin);
        bridge.fee_bps = new_fee_bps;
        bridge.fee_recipient = new_fee_recipient;
        emit!(FeeUpdated {
            new_fee_bps,
            new_fee_recipient,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  set_relayer — Admin rotates the relayer pubkey
    // ─────────────────────────────────────────────────────────────────────────
    pub fn set_relayer(
        ctx: Context<SetRelayer>,
        new_relayer: Pubkey,
    ) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge_state;
        require!(ctx.accounts.admin.key() == bridge.admin, BridgeError::UnauthorizedAdmin);
        bridge.relayer = new_relayer;
        emit!(RelayerUpdated {
            new_relayer,
        });
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  pause — Admin pauses the bridge
    // ─────────────────────────────────────────────────────────────────────────
    pub fn pause(
        ctx: Context<PauseUnpause>,
    ) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge_state;
        require!(ctx.accounts.admin.key() == bridge.admin, BridgeError::UnauthorizedAdmin);
        bridge.paused = true;
        emit!(BridgePaused {});
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  unpause — Admin unpauses the bridge
    // ─────────────────────────────────────────────────────────────────────────
    pub fn unpause(
        ctx: Context<PauseUnpause>,
    ) -> Result<()> {
        let bridge = &mut ctx.accounts.bridge_state;
        require!(ctx.accounts.admin.key() == bridge.admin, BridgeError::UnauthorizedAdmin);
        bridge.paused = false;
        emit!(BridgeUnpaused {});
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  create_wrapped_mint — Admin creates a new SPL mint for a wrapped EVM asset
    // ─────────────────────────────────────────────────────────────────────────
    pub fn create_wrapped_mint(
        ctx: Context<CreateWrappedMint>,
        origin_chain_id: u64,
        foreign_asset_id: [u8; 32],
        decimals: u8,
    ) -> Result<()> {
        let bridge = &ctx.accounts.bridge_state;
        require!(ctx.accounts.admin.key() == bridge.admin, BridgeError::UnauthorizedAdmin);

        emit!(WrappedMintCreated {
            mint: ctx.accounts.wrapped_mint.key(),
            origin_chain_id,
            foreign_asset_id,
            decimals,
        });
        Ok(())
    }
}

// ─── Account Contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = BridgeState::LEN,
        seeds = [BRIDGE_SEED],
        bump
    )]
    pub bridge_state: Account<'info, BridgeState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, dest_chain_id: u64, dest_recipient: [u8;32], bridge_nonce: [u8;32])]
pub struct LockNative<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,

    pub mint: Account<'info, Mint>,

    /// Vault PDA authority — owns the vault_token_account
    /// CHECK: PDA authority, no data needed
    #[account(seeds = [VAULT_SEED, mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint      = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint)]
    pub fee_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = NonceAccount::LEN,
        seeds = [NONCE_SEED, &bridge_nonce],
        bump
    )]
    pub nonce_account: Account<'info, NonceAccount>,

    pub token_program:       Program<'info, Token>,
    pub system_program:      Program<'info, System>,
    pub associated_token_program: anchor_spl::associated_token::AssociatedToken,
}

#[derive(Accounts)]
#[instruction(amount: u64, bridge_nonce: [u8;32], origin_chain_id: u64)]
pub struct UnlockNative<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    pub recipient: SystemAccount<'info>,

    #[account(seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,

    pub mint: Account<'info, Mint>,

    /// CHECK: PDA authority
    #[account(seeds = [VAULT_SEED, mint.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = vault_authority)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::authority = recipient)]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = relayer,
        space = NonceAccount::LEN,
        seeds = [NONCE_SEED, &bridge_nonce],
        bump
    )]
    pub nonce_account: Account<'info, NonceAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: anchor_spl::associated_token::AssociatedToken,
}

#[derive(Accounts)]
#[instruction(amount: u64, bridge_nonce: [u8;32], origin_chain_id: u64)]
pub struct MintWrapped<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    pub recipient: SystemAccount<'info>,

    #[account(seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,

    #[account(mut)]
    pub wrapped_mint: Account<'info, Mint>,

    /// CHECK: PDA mint authority for wrapped tokens
    #[account(seeds = [MINT_AUTH_SEED, wrapped_mint.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut, token::mint = wrapped_mint, token::authority = recipient)]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = relayer,
        space = NonceAccount::LEN,
        seeds = [NONCE_SEED, &bridge_nonce],
        bump
    )]
    pub nonce_account: Account<'info, NonceAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, dest_chain_id: u64, dest_recipient: [u8;32], bridge_nonce: [u8;32])]
pub struct BurnWrapped<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,

    #[account(mut)]
    pub wrapped_mint: Account<'info, Mint>,

    /// CHECK: PDA mint authority
    #[account(seeds = [MINT_AUTH_SEED, wrapped_mint.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(mut, token::mint = wrapped_mint, token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = wrapped_mint)]
    pub fee_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = NonceAccount::LEN,
        seeds = [NONCE_SEED, &bridge_nonce],
        bump
    )]
    pub nonce_account: Account<'info, NonceAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetFee<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,
}

#[derive(Accounts)]
pub struct SetRelayer<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,
}

#[derive(Accounts)]
pub struct PauseUnpause<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mut, seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,
}

#[derive(Accounts)]
#[instruction(origin_chain_id: u64, foreign_asset_id: [u8; 32], decimals: u8)]
pub struct CreateWrappedMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(seeds = [BRIDGE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,

    #[account(
        init,
        payer = admin,
        seeds = [WRAPPED_MINT_SEED, &origin_chain_id.to_le_bytes(), &foreign_asset_id],
        bump,
        mint::decimals = decimals,
        mint::authority = mint_authority,
    )]
    pub wrapped_mint: Account<'info, Mint>,

    #[account(seeds = [MINT_AUTH_SEED, wrapped_mint.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ─── State Accounts ───────────────────────────────────────────────────────────

#[account]
pub struct BridgeState {
    pub admin:         Pubkey, // 32
    pub relayer:       Pubkey, // 32
    pub fee_recipient: Pubkey, // 32
    pub fee_bps:       u16,   // 2
    pub paused:        bool,  // 1
    pub bump:          u8,    // 1
}

impl BridgeState {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 2 + 1 + 1 + 64; // +64 padding
}

#[account]
pub struct NonceAccount {
    pub used: bool, // 1
    pub bump: u8,   // 1
}

impl NonceAccount {
    pub const LEN: usize = 8 + 1 + 1 + 32; // +32 padding
}

// ─── Events (consumed by the Relayer) ────────────────────────────────────────

#[event]
pub struct BridgeInitialized {
    pub admin:   Pubkey,
    pub relayer: Pubkey,
    pub fee_bps: u16,
}

/// Emitted when a user locks SPL tokens to bridge to EVM.
#[event]
pub struct Locked {
    pub sender:         Pubkey,
    pub mint:           Pubkey,
    pub amount:         u64,
    pub fee:            u64,
    pub dest_chain_id:  u64,
    pub dest_recipient: [u8; 32],
    pub bridge_nonce:   [u8; 32],
}

/// Emitted when relayer releases locked SPL tokens to a recipient.
#[event]
pub struct Unlocked {
    pub bridge_nonce:    [u8; 32],
    pub recipient:       Pubkey,
    pub mint:            Pubkey,
    pub amount:          u64,
    pub origin_chain_id: u64,
}

/// Emitted when relayer mints wrapped SPL tokens representing an EVM asset.
#[event]
pub struct WrappedMinted {
    pub bridge_nonce:    [u8; 32],
    pub recipient:       Pubkey,
    pub wrapped_mint:    Pubkey,
    pub amount:          u64,
    pub origin_chain_id: u64,
}

/// Emitted when user burns wrapped SPL tokens to unlock on EVM.
#[event]
pub struct Burned {
    pub sender:         Pubkey,
    pub wrapped_mint:   Pubkey,
    pub amount:         u64,
    pub fee:            u64,
    pub dest_chain_id:  u64,
    pub dest_recipient: [u8; 32],
    pub bridge_nonce:   [u8; 32],
}

#[event]
pub struct FeeUpdated {
    pub new_fee_bps: u16,
    pub new_fee_recipient: Pubkey,
}

#[event]
pub struct RelayerUpdated {
    pub new_relayer: Pubkey,
}

#[event]
pub struct BridgePaused {}

#[event]
pub struct BridgeUnpaused {}

#[event]
pub struct WrappedMintCreated {
    pub mint: Pubkey,
    pub origin_chain_id: u64,
    pub foreign_asset_id: [u8; 32],
    pub decimals: u8,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum BridgeError {
    #[msg("Bridge is currently paused")]
    Paused,
    #[msg("Amount must be greater than zero")]
    AmountZero,
    #[msg("Nonce has already been used")]
    NonceAlreadyUsed,
    #[msg("Caller is not the authorized relayer")]
    Unauthorized,
    #[msg("Caller is not the admin")]
    UnauthorizedAdmin,
    #[msg("Fee exceeds maximum allowed (10%)")]
    FeeTooHigh,
    #[msg("Arithmetic overflow")]
    Overflow,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn compute_fee(amount: u64, fee_bps: u16) -> u64 {
    (amount as u128 * fee_bps as u128 / 10_000) as u64
}
