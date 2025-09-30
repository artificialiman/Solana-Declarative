// SolD Parser - HTML to Anchor/Rust Compiler
// Compiles declarative HTML syntax to secure Anchor smart contracts

import * as fs from 'fs';
import * as path from 'path';

// Type definitions
interface SolDTypes {
  address: string;
  duration: string;
  amount: string;
  percent: number;
  string: string;
  wallets: string[];
  network: 'DEVNET' | 'MAINNET' | 'TESTNET';
}

interface TokenConfig {
  name: string;
  symbol: string;
  supply: string;
}

interface LogoConfig {
  nft?: string;
}

interface TimelockConfig {
  duration: string;
  wallets: string[];
}

interface InsuranceConfig {
  wallets: string[];
  limit: number;
}

interface TransferConfig {
  sol?: string;
  usdc?: string;
}

interface RelockConfig {
  duration: string;
  escrow: string;
}

interface FeesConfig {
  recipient: string;
  launch: string;
  trading?: string;
}

interface SolDConfig {
  network: SolDTypes['network'];
  token: TokenConfig;
  logo: LogoConfig;
  timelock: TimelockConfig;
  insurance: InsuranceConfig;
  transfer: TransferConfig;
  relock: RelockConfig;
  fees: FeesConfig;
}

class SolDParser {
  private readonly FEE_RECIPIENT = 'GR8TuDpbnDvuLzW4JBCLjbeLvGFs1p21XBytLx6rA7XD';
  private readonly MIN_TIMELOCK_DAYS = 100;
  private readonly MAX_SUPPLY = '18446744073709551615';

  parse(soldCode: string): SolDConfig {
    const lines = soldCode.trim().split('\n').map(line => line.trim());
    
    // Parse network declaration
    const network = this.parseNetwork(lines[0]);
    
    // Parse HTML tags
    const config: Partial<SolDConfig> = { network };
    
    for (const line of lines.slice(1)) {
      if (line.startsWith('<token')) {
        config.token = this.parseToken(line);
      } else if (line.startsWith('<logo')) {
        config.logo = this.parseLogo(line);
      } else if (line.startsWith('<timelock')) {
        config.timelock = this.parseTimelock(line);
      } else if (line.startsWith('<insurance')) {
        config.insurance = this.parseInsurance(line);
      } else if (line.startsWith('<transfer')) {
        config.transfer = this.parseTransfer(line);
      } else if (line.startsWith('<relock')) {
        config.relock = this.parseRelock(line);
      } else if (line.startsWith('<fees')) {
        config.fees = this.parseFees(line);
      }
    }

    this.validateConfig(config as SolDConfig);
    return config as SolDConfig;
  }

  private parseNetwork(line: string): SolDTypes['network'] {
    const network = line.trim() as SolDTypes['network'];
    if (!['DEVNET', 'MAINNET', 'TESTNET'].includes(network)) {
      throw new Error(`Invalid network: ${network}. Must be DEVNET, MAINNET, or TESTNET`);
    }
    return network;
  }

  private parseToken(line: string): TokenConfig {
    const nameMatch = line.match(/name="([^"]+)"/);
    const symbolMatch = line.match(/symbol="([^"]+)"/);
    const supplyMatch = line.match(/supply="([^"]+)"/);

    if (!nameMatch || !symbolMatch || !supplyMatch) {
      throw new Error('Token tag must include name, symbol, and supply attributes');
    }

    return {
      name: nameMatch[1],
      symbol: symbolMatch[1],
      supply: supplyMatch[1]
    };
  }

  private parseLogo(line: string): LogoConfig {
    const nftMatch = line.match(/nft="([^"]+)"/);
    return nftMatch ? { nft: nftMatch[1] } : {};
  }

  private parseTimelock(line: string): TimelockConfig {
    const durationMatch = line.match(/duration="([^"]+)"/);
    const walletsMatch = line.match(/wallets=\[([^\]]+)\]/);

    if (!durationMatch) {
      throw new Error('Timelock must specify duration');
    }

    const wallets = walletsMatch ? 
      walletsMatch[1].split(',').map(w => w.trim().replace(/"/g, '')) : [];

    return {
      duration: durationMatch[1],
      wallets
    };
  }

  private parseInsurance(line: string): InsuranceConfig {
    const walletsMatch = line.match(/wallets=\[([^\]]+)\]/);
    const limitMatch = line.match(/limit="(\d+)"/);

    if (!walletsMatch || !limitMatch) {
      throw new Error('Insurance must specify wallets and limit');
    }

    return {
      wallets: walletsMatch[1].split(',').map(w => w.trim().replace(/"/g, '')),
      limit: parseInt(limitMatch[1])
    };
  }

  private parseTransfer(line: string): TransferConfig {
    const solMatch = line.match(/sol="([^"]+)"/);
    const usdcMatch = line.match(/usdc="([^"]+)"/);

    const transfer: TransferConfig = {};
    if (solMatch) transfer.sol = solMatch[1];
    if (usdcMatch) transfer.usdc = usdcMatch[1];

    return transfer;
  }

  private parseRelock(line: string): RelockConfig {
    const durationMatch = line.match(/duration="([^"]+)"/);
    const escrowMatch = line.match(/escrow="([^"]+)"/);

    if (!durationMatch || !escrowMatch) {
      throw new Error('Relock must specify duration and escrow');
    }

    return {
      duration: durationMatch[1],
      escrow: escrowMatch[1]
    };
  }

  private parseFees(line: string): FeesConfig {
    const recipientMatch = line.match(/recipient="([^"]+)"/);
    const launchMatch = line.match(/launch="([^"]+)"/);
    const tradingMatch = line.match(/trading="([^"]+)"/);

    if (!recipientMatch || !launchMatch) {
      throw new Error('Fees must specify recipient and launch amount');
    }

    return {
      recipient: recipientMatch[1],
      launch: launchMatch[1],
      trading: tradingMatch?.[1]
    };
  }

  private validateConfig(config: SolDConfig): void {
    // Validate timelock minimum
    const duration = this.parseDuration(config.timelock.duration);
    const minDuration = this.MIN_TIMELOCK_DAYS * 24 * 60 * 60; // 100 days in seconds
    
    if (duration < minDuration) {
      throw new Error(`Timelock duration must be at least ${this.MIN_TIMELOCK_DAYS} days`);
    }

    // Validate supply
    const supply = BigInt(config.token.supply);
    const maxSupply = BigInt(this.MAX_SUPPLY);
    
    if (supply > maxSupply) {
      throw new Error(`Token supply cannot exceed ${this.MAX_SUPPLY}`);
    }

    // Validate fee recipient
    if (config.fees.recipient !== this.FEE_RECIPIENT) {
      throw new Error(`Fee recipient must be ${this.FEE_RECIPIENT}`);
    }

    // Validate insurance limit
    if (config.insurance.limit > 50) {
      throw new Error('Insurance withdrawal limit cannot exceed 50%');
    }
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error('Invalid duration format. Use format like "100d", "24h", "60m", "3600s"');
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      's': 1,
      'm': 60,
      'h': 3600,
      'd': 86400
    };

    return value * multipliers[unit];
  }

  compile(config: SolDConfig): string {
    return this.generateAnchorProgram(config);
  }

  private generateAnchorProgram(config: SolDConfig): string {
    const programName = config.token.symbol.toLowerCase() + '_launch';
    
    return `use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint};
use anchor_spl::associated_token::AssociatedToken;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod ${programName} {
    use super::*;

    pub fn initialize_launch(
        ctx: Context<InitializeLaunch>,
        token_name: String,
        token_symbol: String,
        token_supply: u64,
        timelock_duration: i64,
        insurance_limit: u8,
    ) -> Result<()> {
        let launch = &mut ctx.accounts.token_launch;
        launch.creator = ctx.accounts.creator.key();
        launch.token_mint = ctx.accounts.token_mint.key();
        launch.token_name = token_name;
        launch.token_symbol = token_symbol;
        launch.total_supply = token_supply;
        launch.timelock_end = Clock::get()?.unix_timestamp + timelock_duration;
        launch.insurance_limit = insurance_limit;
        launch.insurance_wallets = vec![${config.insurance.wallets.map(w => `"${w}".parse().unwrap()`).join(', ')}];
        launch.fees_collected = 0;
        
        // Collect launch fee
        let fee_amount = ${this.calculateLaunchFee(config)};
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, fee_amount)?;
        
        launch.fees_collected = fee_amount;
        
        Ok(())
    }

    pub fn transfer_tokens(
        ctx: Context<TransferTokens>,
        amount: u64,
    ) -> Result<()> {
        let launch = &ctx.accounts.token_launch;
        
        // Check if timelock has expired
        let current_time = Clock::get()?.unix_timestamp;
        if current_time < launch.timelock_end {
            return Err(ErrorCode::TimelockActive.into());
        }
        
        // Collect trading fee
        let trading_fee = ${config.fees.trading || '5000'}; // lamports
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, trading_fee)?;

        // Transfer tokens
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.from.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn emergency_withdraw(
        ctx: Context<EmergencyWithdraw>,
        amount: u64,
    ) -> Result<()> {
        let launch = &ctx.accounts.token_launch;
        
        // Verify caller is authorized insurance wallet
        let caller = ctx.accounts.authority.key();
        if !launch.insurance_wallets.contains(&caller) {
            return Err(ErrorCode::UnauthorizedInsurance.into());
        }
        
        // Check withdrawal limit
        let max_withdraw = (launch.total_supply * launch.insurance_limit as u64) / 100;
        if amount > max_withdraw {
            return Err(ErrorCode::ExceedsInsuranceLimit.into());
        }

        // Execute withdrawal
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.from.to_account_info(),
            to: ctx.accounts.to.to_account_info(),
            authority: ctx.accounts.authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn relock_tokens(
        ctx: Context<RelockTokens>,
        new_duration: i64,
    ) -> Result<()> {
        let launch = &mut ctx.accounts.token_launch;
        
        // Only escrow can relock
        if ctx.accounts.authority.key() != "${config.relock.escrow}".parse().unwrap() {
            return Err(ErrorCode::UnauthorizedRelock.into());
        }
        
        // Extend timelock
        launch.timelock_end = Clock::get()?.unix_timestamp + new_duration;
        
        // Collect relock fee
        let relock_fee = 20000000; // 0.02 SOL in lamports
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.fee_recipient.to_account_info(),
            },
        );
        anchor_lang::system_program::transfer(cpi_context, relock_fee)?;
        
        Ok(())
    }
}

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
    
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: Fee recipient address is validated in instruction
    #[account(mut, address = "${this.FEE_RECIPIENT}".parse().unwrap())]
    pub fee_recipient: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
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
    pub from: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    
    pub authority: Signer<'info>,
    
    /// CHECK: Fee recipient address is validated
    #[account(mut, address = "${this.FEE_RECIPIENT}".parse().unwrap())]
    pub fee_recipient: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
    #[account(
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub to: Account<'info, TokenAccount>,
    
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RelockTokens<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(
        mut,
        seeds = [b"launch", token_mint.key().as_ref()],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: Fee recipient address is validated
    #[account(mut, address = "${this.FEE_RECIPIENT}".parse().unwrap())]
    pub fee_recipient: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[account]
pub struct TokenLaunch {
    pub creator: Pubkey,
    pub token_mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub total_supply: u64,
    pub timelock_end: i64,
    pub insurance_wallets: Vec<Pubkey>,
    pub insurance_limit: u8,
    pub fees_collected: u64,
}

impl TokenLaunch {
    pub fn space() -> usize {
        8 + // discriminator
        32 + // creator
        32 + // token_mint  
        (4 + 32) + // token_name (String)
        (4 + 10) + // token_symbol (String)
        8 + // total_supply
        8 + // timelock_end
        (4 + 32 * 10) + // insurance_wallets (max 10)
        1 + // insurance_limit
        8 // fees_collected
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Timelock is still active")]
    TimelockActive,
    #[msg("Caller is not authorized insurance wallet")]
    UnauthorizedInsurance,
    #[msg("Amount exceeds insurance withdrawal limit")]
    ExceedsInsuranceLimit,
    #[msg("Caller is not authorized to relock")]
    UnauthorizedRelock,
}`;
  }

  private calculateLaunchFee(config: SolDConfig): number {
    const baseFee = 10000000; // 0.01 SOL in lamports
    const insuranceFee = config.insurance.wallets.length * 10000000; // 0.01 SOL per wallet
    const logoFee = config.logo.nft ? 5000000 : 0; // 0.005 SOL for logo
    
    return baseFee + insuranceFee + logoFee;
  }
}

// CLI Interface
export class SolDCLI {
  private parser = new SolDParser();

  async compile(inputFile: string, outputDir: string): Promise<void> {
    try {
      const soldCode = fs.readFileSync(inputFile, 'utf8');
      const config = this.parser.parse(soldCode);
      const anchorCode = this.parser.compile(config);
      
      // Create output directory structure
      const programDir = path.join(outputDir, 'programs', config.token.symbol.toLowerCase() + '_launch');
      fs.mkdirSync(programDir, { recursive: true });
      
      // Write lib.rs
      fs.writeFileSync(path.join(programDir, 'src', 'lib.rs'), anchorCode);
      
      // Write Cargo.toml
      const cargoToml = this.generateCargoToml(config);
      fs.writeFileSync(path.join(programDir, 'Cargo.toml'), cargoToml);
      
      // Write Anchor.toml
      const anchorToml = this.generateAnchorToml(config);
      fs.writeFileSync(path.join(outputDir, 'Anchor.toml'), anchorToml);
      
      console.log(`✅ Successfully compiled SolD to Anchor program`);
      console.log(`📁 Output directory: ${outputDir}`);
      console.log(`🚀 Run 'anchor build' to compile the program`);
      
    } catch (error) {
      console.error('❌ Compilation failed:', error.message);
      process.exit(1);
    }
  }

  private generateCargoToml(config: SolDConfig): string {
    return `[package]
name = "${config.token.symbol.toLowerCase()}_launch"
version = "0.1.0"
description = "Generated by SolD - ${config.token.name} token launch"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "${config.token.symbol.toLowerCase()}_launch"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = "0.28.0"
anchor-spl = "0.28.0"`;
  }

  private generateAnchorToml(config: SolDConfig): string {
    const network = config.network.toLowerCase();
    return `[features]
seeds = false
skip-lint = false

[programs.${network}]
${config.token.symbol.toLowerCase()}_launch = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "${network}"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"`;
  }
}

// Export for use
export { SolDParser, SolDCLI };

// Example usage
if (require.main === module) {
  const cli = new SolDCLI();
  const [,, inputFile, outputDir] = process.argv;
  
  if (!inputFile || !outputDir) {
    console.log('Usage: node sold-parser.js <input.sold> <output-directory>');
    process.exit(1);
  }
  
  cli.compile(inputFile, outputDir);
}