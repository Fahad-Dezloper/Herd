//! Herd - a game where you win by saying what everyone else says.
//!
//! PHASE 1: spikes only. Nothing here is the game yet. These instructions exist
//! to answer three questions the whole design rests on, and each of them could
//! send us back to the drawing board:
//!
//!   1. Can state be committed out of a rollup back to Solana? Without it the
//!      pot cannot pay out.
//!   2. Can an ephemeral permission have *no* readable members, so that not even
//!      the players can read each other's sealed answers? The obvious
//!      alternative - one permissioned account per player - costs rent per
//!      account and drags the fee payer back into the picture.
//!   3. Does VRF work from inside a rollup, request and callback? The rule that
//!      defeats collusion is drawn after answers are sealed, so it has to.
//!
//! Everything is exercised through one `Probe` account so the three answers come
//! from the same deployment rather than three different ones.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, Member};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{
    EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID,
};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_scoped_randomness_ix, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::{self as vrf_api};

declare_id!("BvKkFUEdiin8KcF6m9CBqYoN9FncGFFy4cxhe5QZSvWN");

pub const PROBE_SEED: &[u8] = b"probe";

/// Lamports a delegated account carries above its own rent exemption.
///
/// A rollup charges ER-local rent when an account sponsors an ephemeral account,
/// and the transaction fee payer cannot pay it: a fee payer whose balance moves
/// inside a rollup must itself be delegated, which no wallet can be. So the
/// delegated account pays, and Anchor's `init` funds exactly the rent-exempt
/// minimum, which leaves it nothing to pay with.
pub const EPHEMERAL_RENT_BUFFER: u64 = 200_000;

#[ephemeral]
#[program]
pub mod herd {
    use super::*;

    /// Base layer. Create the probe with a little headroom.
    pub fn init_probe(ctx: Context<InitProbe>) -> Result<()> {
        let probe = &mut ctx.accounts.probe;
        probe.owner = ctx.accounts.owner.key();
        probe.value = 0;
        probe.randomness = [0u8; 32];
        probe.rolled = false;
        probe.bump = ctx.bumps.probe;

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.probe.to_account_info(),
                },
            ),
            EPHEMERAL_RENT_BUFFER,
        )?;

        Ok(())
    }

    /// Base layer. Hand the probe to a rollup, pinned to a chosen validator.
    pub fn delegate_probe(ctx: Context<DelegateProbe>, validator: Option<Pubkey>) -> Result<()> {
        let owner = ctx.accounts.owner.key();
        ctx.accounts.delegate_probe(
            &ctx.accounts.owner,
            &[PROBE_SEED, owner.as_ref()],
            DelegateConfig {
                validator,
                ..DelegateConfig::default()
            },
        )?;
        Ok(())
    }

    /// Rollup. Cheapest possible write, to prove the probe is mutable there.
    pub fn bump_probe(ctx: Context<BumpProbe>) -> Result<()> {
        let probe = &mut ctx.accounts.probe;
        probe.value = probe.value.saturating_add(1);
        msg!("herd: probe value {}", probe.value);
        Ok(())
    }

    /// SPIKE 1b. Rollup. Seal the probe so *nobody* can read it over RPC.
    ///
    /// `members` is deliberately empty. In the game, players must not be able to
    /// read each other's answers, so a permission listing every player is no
    /// good - the program inside the rollup needs to see the answers and nobody
    /// outside it does. Whether a zero-member permission is legal is exactly
    /// what this proves.
    ///
    /// The probe pays its own rent; see EPHEMERAL_RENT_BUFFER.
    pub fn seal_probe(ctx: Context<SealProbe>) -> Result<()> {
        let owner = ctx.accounts.probe.owner;
        let bump = ctx.accounts.probe.bump;
        let seeds: &[&[u8]] = &[PROBE_SEED, owner.as_ref(), &[bump]];

        CreateEphemeralPermissionCpi {
            permissioned_account: ctx.accounts.probe.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            payer: ctx.accounts.probe.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: Vec::<Member>::new(),
            },
        }
        .invoke_signed(&[seeds])?;

        msg!("herd: probe sealed to nobody");
        Ok(())
    }

    /// SPIKE 1a. Rollup. Push the probe's current state back to Solana without
    /// giving it up - the shape settlement needs, since a room pays out while
    /// the game is still delegated.
    pub fn commit_probe(ctx: Context<CommitProbe>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.probe.to_account_info()])
        .build_and_invoke()?;

        msg!("herd: probe committed");
        Ok(())
    }

    /// Rollup. Commit and hand the probe back to Solana.
    pub fn undelegate_probe(ctx: Context<CommitProbe>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.owner.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.probe.to_account_info()])
        .build_and_invoke()?;

        msg!("herd: probe committed and undelegated");
        Ok(())
    }

    /// SPIKE 1c. Ask the oracle for randomness.
    ///
    /// Acceptance is not fulfilment: this returning Ok only means the oracle
    /// took the job. The result exists once `callback_roll` has run.
    pub fn request_roll(ctx: Context<RequestRoll>, client_seed: u8) -> Result<()> {
        let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::CallbackRoll::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta {
                    pubkey: ctx.accounts.probe.key(),
                    is_signer: false,
                    is_writable: true,
                },
            ]),
            ..Default::default()
        });

        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// The oracle's answer. `#[vrf_callback]` is what stops anyone else calling
    /// this with randomness of their choosing.
    pub fn callback_roll(ctx: Context<CallbackRoll>, randomness: [u8; 32]) -> Result<()> {
        let probe = &mut ctx.accounts.probe;
        probe.randomness = randomness;
        probe.rolled = true;
        msg!("herd: randomness delivered, first byte {}", randomness[0]);
        Ok(())
    }
}

/* --------------------------------------------------------------------- state */

#[account]
#[derive(InitSpace)]
pub struct Probe {
    pub owner: Pubkey,
    pub value: u64,
    pub randomness: [u8; 32],
    pub rolled: bool,
    pub bump: u8,
}

/* ---------------------------------------------------------------- contexts */

#[derive(Accounts)]
pub struct InitProbe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Probe::INIT_SPACE,
        seeds = [PROBE_SEED, owner.key().as_ref()],
        bump
    )]
    pub probe: Account<'info, Probe>,

    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateProbe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// CHECK: the delegation CPI reassigns the owner; seeds are re-derived and
    /// checked inside `delegate_account`.
    #[account(mut, del)]
    pub probe: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct BumpProbe<'info> {
    #[account(
        mut,
        seeds = [PROBE_SEED, probe.owner.as_ref()],
        bump = probe.bump
    )]
    pub probe: Account<'info, Probe>,
}

#[derive(Accounts)]
pub struct SealProbe<'info> {
    #[account(
        mut,
        seeds = [PROBE_SEED, probe.owner.as_ref()],
        bump = probe.bump
    )]
    pub probe: Account<'info, Probe>,

    /// CHECK: derived and validated by the permission program.
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,

    /// CHECK: collects ER-local rent; address-constrained.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,

    /// CHECK: runtime builtin; address-constrained.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,

    /// CHECK: access-control program; address-constrained.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitProbe<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [PROBE_SEED, owner.key().as_ref()],
        bump = probe.bump,
        has_one = owner
    )]
    pub probe: Account<'info, Probe>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRoll<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [PROBE_SEED, probe.owner.as_ref()],
        bump = probe.bump
    )]
    pub probe: Account<'info, Probe>,

    /// CHECK: one of the known oracle queues.
    #[account(
        mut,
        constraint =
            oracle_queue.key() == vrf_api::consts::DEFAULT_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_TEST_QUEUE
            || oracle_queue.key() == vrf_api::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackRoll<'info> {
    #[account(mut)]
    pub probe: Account<'info, Probe>,
}
