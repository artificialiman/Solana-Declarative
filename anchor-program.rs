// Generated Anchor Program by SolD Parser
// Safety-first token launch program with fraud protection
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, MintTo, Transfer};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("So1DLaunchProgram11111111111111111111111111");

const FEE_RECIPIENT: &str = "GR8TuDpbnDvuLzW4JBCLjbeLvGFs1p21XBytLx6rA7XD";
const MIN_TIMELOCK_DURATION: i64 = 8_640_000; // 100 days in seconds
const MAX_INSURANCE_WALLETS: usize = 10;
const MAX_INSURANCE_LIMIT: u8 = 50; // 50%

#[program]
pub mod sold_token_launch {
    use super::*;

    /// Initialize a new token launch with SolD parameters
    pub fn initialize_launch(
        ctx: Context<InitializeLaunch>,
        params: LaunchParams,
    ) -> Result<()> {
        let launch = &mut ctx.accounts.token_launch;
        let clock = Clock::get()?;

        // Validate parameters
        require!(
            params.timelock_duration >= MIN_TIMELOCK_DURATION,
            TokenLaunchError::TimelockTooShort
        );
        require!(
            params.insurance_wallets.len() <= MAX_INSURANCE_WALLETS,
            TokenLaunchError::TooManyInsuranceWallets
        );
        require!(
            params.insurance_limit <= MAX_INSURANCE_LIMIT,
            TokenLaunchError::InsuranceLimitTooHigh
        );

        // Initialize launch state
        launch.creator = ctx.accounts.creator.key();
        launch.token_mint = ctx.accounts.token_mint.key();
        launch.token_name = params.token_name;
        launch.token_symbol = params.token_symbol;
        launch.total_supply = params.total_supply;
        launch.timelock_end = clock.unix_timestamp + params.timelock_duration;
        launch.insurance_wallets = params.insurance_wallets;
        launch.insurance_limit = params.insurance_limit;
        launch.logo_nft = params.logo_nft;
        launch.fraud_score = params.fraud_score;
        launch.fees_collected = 0;
        launch.is_active = true;
        launch.relock_count = 0;
        launch.total_withdrawn = 0;

        // Calculate and collect launch fee
        let base_fee: u64 = 10_000_000; // 0.01 SOL
        let insurance_fee = (launch.insurance_wallets.len() as u64) * 10_000_000; // 0.01 SOL per wallet
        let logo_fee = if launch.logo_nft.is_some() { 5_000_000 } else { 0 }; // 0.005 SOL
        let total_fee = base_fee + insurance_fee + logo_fee;

        // Transfer fee to recipient
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, total_fee)?;

        launch.fees_collected = total_fee;

        msg!("Token launch initialized: {} ({})", launch.token_name, launch.token_symbol);
        msg!("Timelock expires: {}", launch.timelock_end);
        msg!("Fraud score: {:.2}", launch.fraud_score);
        msg!("Fee collected: {} lamports", total_fee);

        Ok(())
    }

    /// Create and mint the initial token supply
    pub fn create_token(
        ctx: Context<CreateToken>,
        decimals: u8,
    ) -> Result<()> {
        let launch = &ctx.accounts.token_launch;
        
        // Mint initial supply to creator
        let cpi_accounts = MintTo {
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.creator_token_account.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::mint_to(cpi_ctx, launch.total_supply)?;

        msg!("Minted {} tokens to creator", launch.total_supply);
        Ok(())
    }

    /// Transfer tokens (only after timelock expires)
    pub fn transfer_tokens(
        ctx: Context<TransferTokens>,
        amount: u64,
    ) -> Result<()> {
        let launch = &ctx.accounts.token_launch;
        let clock = Clock::get()?;

        // Check if launch is active
        require!(launch.is_active, TokenLaunchError::LaunchInactive);

        // Check if timelock has expired
        require!(
            clock.unix_timestamp >= launch.timelock_end,
            TokenLaunchError::TimelockActive
        );

        // Collect trading fee (2x Solana base fee)
        let trading_fee: u64 = 10_000; // ~0.00001 SOL
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, trading_fee)?;

        // Execute token transfer
        let cpi_accounts = Transfer {
            from: ctx.accounts.from_token_account.to_account_info(),
            to: ctx.accounts.to_token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, amount)?;

        msg!("Transferred {} tokens (fee: {} lamports)", amount, trading_fee);
        Ok(())
    }

    /// Emergency withdrawal by authorized insurance wallets
    pub fn emergency_withdraw(
        ctx: Context<EmergencyWithdraw>,
        amount: u64,
        justification: String,
    ) -> Result<()> {
        let launch = &mut ctx.accounts.token_launch;
        let caller = ctx.accounts.authority.key();

        // Verify caller is authorized insurance wallet
        require!(
            launch.insurance_wallets.contains(&caller),
            TokenLaunchError::UnauthorizedInsurance
        );

        // Check withdrawal limit
        let max_withdraw = (launch.total_supply * launch.insurance_limit as u64) / 100;
        require!(
            launch.total_withdrawn + amount <= max_withdraw,
            TokenLaunchError::ExceedsInsuranceLimit
        );

        // Collect higher fee for emergency withdrawals
        let emergency_fee: u64 = 50_000; // 0.00005 SOL
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, emergency_fee)?;

        // Execute emergency withdrawal
        let cpi_accounts = Transfer {
            from: ctx.accounts.from_token_account.to_account_info(),
            to: ctx.accounts.to_token_account.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::transfer(cpi_ctx, amount)?;

        // Update withdrawal tracking
        launch.total_withdrawn += amount;

        msg!("Emergency withdrawal: {} tokens", amount);
        msg!("Justification: {}", justification);
        msg!("Total withdrawn: {}/{}", launch.total_withdrawn, max_withdraw);

        Ok(())
    }

    /// Relock tokens with new timelock period (escrow only)
    pub fn relock_tokens(
        ctx: Context<RelockTokens>,
        new_duration: i64,
        reason: String,
    ) -> Result<()> {
        let launch = &mut ctx.accounts.token_launch;
        let clock = Clock::get()?;

        // Only authorized escrow can relock
        require!(
            ctx.accounts.escrow_authority.key() == FEE_RECIPIENT.parse().unwrap(),
            TokenLaunchError::UnauthorizedRelock
        );

        // Validate new duration
        require!(
            new_duration >= MIN_TIMELOCK_DURATION,
            TokenLaunchError::TimelockTooShort
        );

        // Collect relock fee
        let relock_fee: u64 = 20_000_000; // 0.02 SOL
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.escrow_authority.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, relock_fee)?;

        // Update timelock
        launch.timelock_end = clock.unix_timestamp + new_duration;
        launch.relock_count += 1;

        msg!("Tokens relocked until: {}", launch.timelock_end);
        msg!("Relock reason: {}", reason);
        msg!("Total relocks: {}", launch.relock_count);

        Ok(())
    }

    /// Update fraud score (AI service only)
    pub fn update_fraud_score(
        ctx: Context<UpdateFraudScore>,
        new_score: f32,
    ) -> Result<()> {
        let launch = &mut ctx.accounts.token_launch;

        // Validate fraud score range
        require!(
            new_score >= 0.0 && new_score <= 1.0,
            TokenLaunchError::InvalidFraudScore
        );

        let old_score = launch.fraud_score;
        launch.fraud_score = new_score;

        // Auto-suspend if fraud score too high
        if new_score > 0.9 {
            launch.is_active = false;
            msg!("Launch auto-suspended due to high fraud score: {:.2}", new_score);
        }

        msg!("Fraud score updated: {:.2} -> {:.2}", old_score, new_score);
        Ok(())
    }

    /// Suspend launch (emergency measure)
    pub fn suspend_launch(
        ctx: Context<SuspendLaunch>,
        reason: String,
    ) -> Result<()> {
        let launch = &mut ctx.accounts.token_launch;
        
        // Only escrow can suspend
        require!(
            ctx.accounts.authority.key() == FEE_RECIPIENT.parse().unwrap(),
            TokenLaunchError::UnauthorizedSuspension
        );

        launch.is_active = false;

        msg!("Launch suspended: {}", reason);
        Ok(())
    }
}

// Account Contexts
#[derive(Accounts)]
pub struct InitializeLaunch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    #[account(
        init,
        payer = creator,
        space = TokenLaunch::space(),
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    /// CHECK: Token mint account
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: Fee recipient address validated in instruction
    #[account(
        mut,
        address = FEE_RECIPIENT.parse().unwrap()
    )]
    pub fee_recipient: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    
    #[account(
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    #[account(mut)]
    pub token_mint: Account<'info, Mint>,
    
    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = creator
    )]
    pub creator_token_account: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct TransferTokens<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,
    
    pub authority: Signer<'info>,
    
    /// CHECK: Fee recipient validated in instruction
    #[account(mut, address = FEE_RECIPIENT.parse().unwrap())]
    pub fee_recipient: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    pub token_mint: Account<'info, Mint>,
}

#[derive(Accounts)]
pub struct SuspendLaunch<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    pub token_mint: Account<'info, Mint>,
}

// Data Structures
#[account]
pub struct TokenLaunch {
    pub creator: Pubkey,                    // 32 bytes
    pub token_mint: Pubkey,                 // 32 bytes
    pub token_name: String,                 // 4 + max 50 bytes
    pub token_symbol: String,               // 4 + max 10 bytes  
    pub total_supply: u64,                  // 8 bytes
    pub timelock_end: i64,                  // 8 bytes
    pub insurance_wallets: Vec<Pubkey>,     // 4 + (32 * count) bytes
    pub insurance_limit: u8,                // 1 byte
    pub logo_nft: Option<Pubkey>,           // 33 bytes (32 + 1 for Option)
    pub fraud_score: f32,                   // 4 bytes
    pub fees_collected: u64,                // 8 bytes
    pub is_active: bool,                    // 1 byte
    pub relock_count: u32,                  // 4 bytes
    pub total_withdrawn: u64,               // 8 bytes
}

impl TokenLaunch {
    pub fn space() -> usize {
        8 +           // discriminator
        32 +          // creator
        32 +          // token_mint
        (4 + 50) +    // token_name
        (4 + 10) +    // token_symbol
        8 +           // total_supply
        8 +           // timelock_end
        (4 + 32 * MAX_INSURANCE_WALLETS) + // insurance_wallets
        1 +           // insurance_limit
        33 +          // logo_nft (Option<Pubkey>)
        4 +           // fraud_score
        8 +           // fees_collected
        1 +           // is_active
        4 +           // relock_count
        8 +           // total_withdrawn
        64            // padding for future fields
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LaunchParams {
    pub token_name: String,
    pub token_symbol: String, 
    pub total_supply: u64,
    pub timelock_duration: i64,
    pub insurance_wallets: Vec<Pubkey>,
    pub insurance_limit: u8,
    pub logo_nft: Option<Pubkey>,
    pub fraud_score: f32,
}

// Custom Errors
#[error_code]
pub enum TokenLaunchError {
    #[msg("Timelock duration must be at least 100 days")]
    TimelockTooShort,
    
    #[msg("Timelock is still active, transfers not allowed")]
    TimelockActive,
    
    #[msg("Too many insurance wallets (max 10)")]
    TooManyInsuranceWallets,
    
    #[msg("Insurance limit cannot exceed 50%")]
    InsuranceLimitTooHigh,
    
    #[msg("Caller is not authorized insurance wallet")]
    UnauthorizedInsurance,
    
    #[msg("Amount exceeds insurance withdrawal limit")]
    ExceedsInsuranceLimit,
    
    #[msg("Only escrow authority can relock tokens")]
    UnauthorizedRelock,
    
    #[msg("Only escrow authority can suspend launch")]
    UnauthorizedSuspension,
    
    #[msg("Fraud score must be between 0.0 and 1.0")]
    InvalidFraudScore,
    
    #[msg("Token launch has been suspended")]
    LaunchInactive,
    
    #[msg("Insufficient fee payment")]
    InsufficientFee,
    
    #[msg("Invalid network for this operation")]
    InvalidNetwork,
}

// Helper Functions
impl TokenLaunch {
    pub fn is_timelock_expired(&self, current_timestamp: i64) -> bool {
        current_timestamp >= self.timelock_end
    }
    
    pub fn get_remaining_insurance_limit(&self) -> u64 {
        let max_withdraw = (self.total_supply * self.insurance_limit as u64) / 100;
        max_withdraw.saturating_sub(self.total_withdrawn)
    }
    
    pub fn calculate_launch_fee(&self) -> u64 {
        let base_fee = 10_000_000; // 0.01 SOL
        let insurance_fee = (self.insurance_wallets.len() as u64) * 10_000_000;
        let logo_fee = if self.logo_nft.is_some() { 5_000_000 } else { 0 };
        
        base_fee + insurance_fee + logo_fee
    }
    
    pub fn is_high_risk(&self) -> bool {
        self.fraud_score > 0.7
    }
    
    pub fn days_until_unlock(&self, current_timestamp: i64) -> i64 {
        if self.is_timelock_expired(current_timestamp) {
            0
        } else {
            (self.timelock_end - current_timestamp) / 86400
        }
    }
}

// Security Validations
pub fn validate_wallet_authority(
    wallet: &Pubkey,
    authorized_wallets: &[Pubkey],
) -> Result<()> {
    require!(
        authorized_wallets.contains(wallet),
        TokenLaunchError::UnauthorizedInsurance
    );
    Ok(())
}

pub fn validate_fee_payment(expected: u64, paid: u64) -> Result<()> {
    require!(paid >= expected, TokenLaunchError::InsufficientFee);
    Ok(())
}

// Event Logging
#[event]
pub struct LaunchCreated {
    pub token_mint: Pubkey,
    pub creator: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub total_supply: u64,
    pub timelock_end: i64,
    pub fraud_score: f32,
    pub fee_paid: u64,
}

#[event]
pub struct TokensTransferred {
    pub token_mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
    pub fee_paid: u64,
}

#[event] 
pub struct EmergencyWithdrawal {
    pub token_mint: Pubkey,
    pub insurance_wallet: Pubkey,
    pub amount: u64,
    pub justification: String,
    pub remaining_limit: u64,
}

#[event]
pub struct TokensRelocked {
    pub token_mint: Pubkey,
    pub old_timelock_end: i64,
    pub new_timelock_end: i64,
    pub reason: String,
    pub relock_count: u32,
}

#[event]
pub struct FraudScoreUpdated {
    pub token_mint: Pubkey,
    pub old_score: f32,
    pub new_score: f32,
    pub auto_suspended: bool,
}

#[event]
pub struct LaunchSuspended {
    pub token_mint: Pubkey,
    pub reason: String,
    pub suspended_at: i64,
}

// Constants for easy reference
pub mod constants {
    pub const SECONDS_PER_DAY: i64 = 86_400;
    pub const MIN_TIMELOCK_DAYS: i64 = 100;
    pub const BASE_FEE_LAMPORTS: u64 = 10_000_000;      // 0.01 SOL
    pub const INSURANCE_FEE_LAMPORTS: u64 = 10_000_000;  // 0.01 SOL per wallet
    pub const LOGO_FEE_LAMPORTS: u64 = 5_000_000;       // 0.005 SOL
    pub const RELOCK_FEE_LAMPORTS: u64 = 20_000_000;    // 0.02 SOL
    pub const TRADING_FEE_LAMPORTS: u64 = 10_000;       // ~0.00001 SOL
    pub const EMERGENCY_FEE_LAMPORTS: u64 = 50_000;     // 0.00005 SOL
}

// Testing utilities (conditional compilation)
#[cfg(test)]
pub mod tests {
    use super::*;
    use anchor_lang::prelude::*;
    
    pub fn create_test_launch_params() -> LaunchParams {
        LaunchParams {
            token_name: "TestToken".to_string(),
            token_symbol: "TEST".to_string(),
            total_supply: 1_000_000_000,
            timelock_duration: constants::MIN_TIMELOCK_DAYS * constants::SECONDS_PER_DAY,
            insurance_wallets: vec![],
            insurance_limit: 5,
            logo_nft: None,
            fraud_score: 0.1,
        }
    }
    
    #[test]
    fn test_fee_calculation() {
        let mut launch = TokenLaunch {
            creator: Pubkey::default(),
            token_mint: Pubkey::default(),
            token_name: "Test".to_string(),
            token_symbol: "TST".to_string(),
            total_supply: 1000000,
            timelock_end: 0,
            insurance_wallets: vec![Pubkey::default(), Pubkey::default()], // 2 wallets
            insurance_limit: 10,
            logo_nft: Some(Pubkey::default()), // Has logo
            fraud_score: 0.0,
            fees_collected: 0,
            is_active: true,
            relock_count: 0,
            total_withdrawn: 0,
        };
        
        let expected_fee = 10_000_000 + (2 * 10_000_000) + 5_000_000; // Base + Insurance + Logo
        assert_eq!(launch.calculate_launch_fee(), expected_fee);
    }
    
    #[test] 
    fn test_timelock_expiry() {
        let launch = TokenLaunch {
            timelock_end: 1000,
            ..Default::default()
        };
        
        assert!(!launch.is_timelock_expired(999));  // Not expired
        assert!(launch.is_timelock_expired(1000));  // Exactly expired
        assert!(launch.is_timelock_expired(1001));  // Past expiry
    }
    
    #[test]
    fn test_insurance_limit() {
        let mut launch = TokenLaunch {
            total_supply: 1000,
            insurance_limit: 10, // 10%
            total_withdrawn: 50,
            ..Default::default()
        };
        
        assert_eq!(launch.get_remaining_insurance_limit(), 50); // 100 - 50 = 50
        
        launch.total_withdrawn = 100;
        assert_eq!(launch.get_remaining_insurance_limit(), 0); // Fully withdrawn
    }
}

// Default implementation for testing
#[cfg(test)]
impl Default for TokenLaunch {
    fn default() -> Self {
        Self {
            creator: Pubkey::default(),
            token_mint: Pubkey::default(),
            token_name: String::new(),
            token_symbol: String::new(),
            total_supply: 0,
            timelock_end: 0,
            insurance_wallets: Vec::new(),
            insurance_limit: 0,
            logo_nft: None,
            fraud_score: 0.0,
            fees_collected: 0,
            is_active: true,
            relock_count: 0,
            total_withdrawn: 0,
        }
    }
}, TokenLaunch>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Fee recipient validated in instruction
    #[account(mut, address = FEE_RECIPIENT.parse().unwrap())]
    pub fee_recipient: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RelockTokens<'info> {
    #[account(mut)]
    pub escrow_authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: Fee recipient validated in instruction
    #[account(mut, address = FEE_RECIPIENT.parse().unwrap())]
    pub fee_recipient: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFraudScore<'info> {
    /// CHECK: AI service authority (validated off-chain)
    pub ai_authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info