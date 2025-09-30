// API Integration Layer - SolD System Orchestrator
// Coordinates SolD Parser, AI Fraud Engine, and Anchor Program

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Connection, PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet } = require('@project-serum/anchor');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Constants
const FEE_RECIPIENT = 'GR8TuDpbnDvuLzW4JBCLjbeLvGFs1p21XBytLx6rA7XD';
const AI_FRAUD_API = process.env.AI_FRAUD_API || 'http://localhost:8000';
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || 'devnet';
const PROGRAM_ID = 'So1DLaunchProgram11111111111111111111111111';

// Solana connection
const connection = new Connection(
    SOLANA_NETWORK === 'mainnet' 
        ? 'https://api.mainnet-beta.solana.com'
        : 'https://api.devnet.solana.com',
    'confirmed'
);

// SolD Parser Integration
class SolDOrchestrator {
    constructor() {
        this.soldParser = null;
        this.anchorProgram = null;
        this.initializeComponents();
    }

    async initializeComponents() {
        try {
            // Initialize SolD Parser (assuming it's compiled to JS)
            const { SolDParser } = require('./sold-parser');
            this.soldParser = new SolDParser();

            // Initialize Anchor Program
            const idl = await this.loadProgramIDL();
            const programId = new PublicKey(PROGRAM_ID);
            const wallet = new Wallet(Keypair.generate()); // Temporary wallet
            const provider = new AnchorProvider(connection, wallet, {});
            this.anchorProgram = new Program(idl, programId, provider);

            console.log('✅ SolD components initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize components:', error);
        }
    }

    async loadProgramIDL() {
        // Load IDL from file or return mock IDL
        try {
            const idlPath = path.join(__dirname, 'idl', 'sold_token_launch.json');
            const idlContent = await fs.readFile(idlPath, 'utf8');
            return JSON.parse(idlContent);
        } catch (error) {
            // Return minimal IDL for testing
            return {
                version: "0.1.0",
                name: "sold_token_launch",
                instructions: [
                    {
                        name: "initializeLaunch",
                        accounts: [],
                        args: []
                    }
                ],
                accounts: [
                    {
                        name: "TokenLaunch",
                        type: {
                            kind: "struct",
                            fields: []
                        }
                    }
                ]
            };
        }
    }

    // Main orchestration method
    async processLaunchRequest(soldCode, network = 'DEVNET') {
        const startTime = Date.now();
        const result = {
            success: false,
            data: null,
            errors: [],
            processingTimeMs: 0,
            steps: {
                parsing: { success: false, timeMs: 0 },
                fraudCheck: { success: false, timeMs: 0, score: 0 },
                compilation: { success: false, timeMs: 0 },
                deployment: { success: false, timeMs: 0 }
            }
        };

        try {
            // Step 1: Parse SolD code
            console.log('🔍 Step 1: Parsing SolD code...');
            const parseStart = Date.now();
            
            const config = this.soldParser.parse(soldCode);
            result.steps.parsing.success = true;
            result.steps.parsing.timeMs = Date.now() - parseStart;
            
            console.log(`✅ Parsing completed in ${result.steps.parsing.timeMs}ms`);

            // Step 2: Fraud detection check
            console.log('🚨 Step 2: Running fraud detection...');
            const fraudStart = Date.now();
            
            const fraudAnalysis = await this.checkFraudRisk(config);
            result.steps.fraudCheck.success = true;
            result.steps.fraudCheck.timeMs = Date.now() - fraudStart;
            result.steps.fraudCheck.score = fraudAnalysis.fraud_score;
            
            console.log(`✅ Fraud check completed: ${fraudAnalysis.fraud_score.toFixed(2)} risk score`);

            // Reject if fraud score too high
            if (fraudAnalysis.fraud_score > 0.8) {
                result.errors.push('Launch rejected due to high fraud risk');
                return result;
            }

            // Step 3: Compile to Anchor program
            console.log('⚙️ Step 3: Compiling Anchor program...');
            const compileStart = Date.now();
            
            const anchorCode = this.soldParser.compile(config);
            const compilationResult = await this.compileAnchorProgram(anchorCode, config);
            result.steps.compilation.success = true;
            result.steps.compilation.timeMs = Date.now() - compileStart;
            
            console.log(`✅ Compilation completed in ${result.steps.compilation.timeMs}ms`);

            // Step 4: Deploy to Solana (simulation for now)
            console.log('🚀 Step 4: Deploying to Solana...');
            const deployStart = Date.now();
            
            const deploymentResult = await this.deployToSolana(config, fraudAnalysis.fraud_score);
            result.steps.deployment.success = true;
            result.steps.deployment.timeMs = Date.now() - deployStart;
            
            console.log(`✅ Deployment completed in ${result.steps.deployment.timeMs}ms`);

            // Success!
            result.success = true;
            result.data = {
                config,
                fraudAnalysis,
                programId: deploymentResult.programId,
                launchPDA: deploymentResult.launchPDA,
                txSignature: deploymentResult.txSignature,
                estimatedFee: this.calculateTotalFees(config)
            };

        } catch (error) {
            console.error('❌ Launch processing failed:', error);
            result.errors.push(error.message);
        }

        result.processingTimeMs = Date.now() - startTime;
        return result;
    }

    async checkFraudRisk(config) {
        try {
            const requestData = {
                creator_wallet: config.timelock?.wallets?.[0] || '',
                insurance_wallets: config.insurance?.wallets || [],
                supply: config.token.supply,
                timelock_duration: this.parseDurationToSeconds(config.timelock.duration),
                launch_fee: config.fees.launch,
                network: config.network
            };

            console.log('📡 Calling fraud detection API...');
            const response = await axios.post(`${AI_FRAUD_API}/analyze-launch`, requestData, {
                timeout: 10000 // 10 second timeout
            });

            return response.data;
        } catch (error) {
            console.warn('⚠️ Fraud API unavailable, using fallback scoring');
            return {
                fraud_score: 0.3, // Default medium risk
                risk_level: 'MEDIUM',
                risk_factors: ['AI service unavailable'],
                recommendations: ['Manual review recommended'],
                wallet_scores: {},
                processing_time_ms: 0
            };
        }
    }

    parseDurationToSeconds(duration) {
        const match = duration.match(/^(\d+)([smhd])$/);
        if (!match) return 8640000; // Default to 100 days

        const value = parseInt(match[1]);
        const unit = match[2];
        const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
        
        return value * multipliers[unit];
    }

    async compileAnchorProgram(anchorCode, config) {
        // Simulate compilation process
        const tempDir = path.join(__dirname, 'temp', `compile_${Date.now()}`);
        
        try {
            // Create temporary directory structure
            await fs.mkdir(tempDir, { recursive: true });
            await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
            
            // Write Anchor code
            await fs.writeFile(path.join(tempDir, 'src', 'lib.rs'), anchorCode);
            
            // Write Cargo.toml
            const cargoToml = this.generateCargoToml(config);
            await fs.writeFile(path.join(tempDir, 'Cargo.toml'), cargoToml);
            
            console.log(`📁 Anchor program files generated in ${tempDir}`);
            
            return {
                success: true,
                outputDir: tempDir,
                programName: `${config.token.symbol.toLowerCase()}_launch`
            };
            
        } catch (error) {
            console.error('Failed to compile Anchor program:', error);
            throw error;
        }
    }

    generateCargoToml(config) {
        return `[package]
name = "${config.token.symbol.toLowerCase()}_launch"
version = "0.1.0"
description = "SolD Generated - ${config.token.name}"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "${config.token.symbol.toLowerCase()}_launch"

[dependencies]
anchor-lang = "0.28.0"
anchor-spl = "0.28.0"

[features]
default = []
no-entrypoint = []
no-idl = []
cpi = ["no-entrypoint"]`;
    }

    async deployToSolana(config, fraudScore) {
        // Simulate deployment - in real implementation, this would:
        // 1. Build the Anchor program
        // 2. Deploy to Solana
        // 3. Initialize the token launch PDA
        
        const mockProgramId = new PublicKey(PROGRAM_ID);
        const mockTokenMint = Keypair.generate().publicKey;
        
        // Generate launch PDA
        const [launchPDA] = await PublicKey.findProgramAddress(
            [Buffer.from('launch'), mockTokenMint.toBuffer()],
            mockProgramId
        );

        // Mock transaction signature
        const mockTxSignature = 'mock_tx_' + Date.now().toString(36) + Math.random().toString(36);

        console.log(`📍 Launch PDA: ${launchPDA.toString()}`);
        console.log(`🏷️ Token Mint: ${mockTokenMint.toString()}`);

        return {
            programId: mockProgramId.toString(),
            launchPDA: launchPDA.toString(),
            tokenMint: mockTokenMint.toString(),
            txSignature: mockTxSignature,
            network: config.network,
            blockTime: Date.now()
        };
    }

    calculateTotalFees(config) {
        const baseFee = 0.01; // SOL
        const insuranceFee = (config.insurance?.wallets?.length || 0) * 0.01;
        const logoFee = config.logo?.nft ? 0.005 : 0;
        
        return baseFee + insuranceFee + logoFee;
    }
}

// Initialize orchestrator
const orchestrator = new SolDOrchestrator();

// API Endpoints

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        network: SOLANA_NETWORK,
        services: {
            soldParser: !!orchestrator.soldParser,
            anchorProgram: !!orchestrator.anchorProgram,
            fraudAPI: AI_FRAUD_API
        }
    });
});

// Process SolD launch
app.post('/launch', async (req, res) => {
    try {
        const { soldCode, network = 'DEVNET' } = req.body;
        
        if (!soldCode) {
            return res.status(400).json({
                error: 'SolD code is required',
                example: `DEVNET

<token name="MyToken" symbol="MTK" supply="1000000" />
<timelock duration="100d" />
<fees recipient="${FEE_RECIPIENT}" launch="0.01" />`
            });
        }

        console.log(`🚀 Processing new launch request (${network})`);
        const result = await orchestrator.processLaunchRequest(soldCode, network);
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Token launch processed successfully',
                ...result
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Token launch processing failed',
                ...result
            });
        }

    } catch (error) {
        console.error('Launch endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Validate SolD code (dry run)
app.post('/validate', async (req, res) => {
    try {
        const { soldCode } = req.body;
        
        if (!soldCode) {
            return res.status(400).json({ error: 'SolD code is required' });
        }

        const config = orchestrator.soldParser.parse(soldCode);
        const estimatedFee = orchestrator.calculateTotalFees(config);
        
        res.json({
            valid: true,
            config,
            estimatedFee,
            network: config.network,
            warnings: []
        });

    } catch (error) {
        res.status(400).json({
            valid: false,
            error: error.message,
            line: error.line || null
        });
    }
});

// Get launch status
app.get('/launch/:launchPDA', async (req, res) => {
    try {
        const { launchPDA } = req.params;
        
        // Mock launch status - in real implementation, query Solana
        res.json({
            launchPDA,
            status: 'active',
            timelockEnd: Date.now() + (100 * 24 * 60 * 60 * 1000), // 100 days from now
            fraudScore: 0.2,
            feesCollected: 0.035,
            totalWithdrawn: 0,
            relockCount: 0
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fee calculator
app.post('/calculate-fee', (req, res) => {
    try {
        const { insuranceWallets = [], hasLogo = false } = req.body;
        
        const baseFee = 0.01;
        const insuranceFee = insuranceWallets.length * 0.01;
        const logoFee = hasLogo ? 0.005 : 0;
        const total = baseFee + insuranceFee + logoFee;
        
        res.json({
            breakdown: {
                base: baseFee,
                insurance: insuranceFee,
                logo: logoFee
            },
            total,
            currency: 'SOL'
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        availableEndpoints: [
            'GET /health',
            'POST /launch',
            'POST /validate', 
            'GET /launch/:launchPDA',
            'POST /calculate-fee'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SolD API Server running on port ${PORT}`);
    console.log(`🌐 Network: ${SOLANA_NETWORK}`);
    console.log(`💰 Fee Recipient: ${FEE_RECIPIENT}`);
    console.log(`🤖 AI Fraud API: ${AI_FRAUD_API}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});

module.exports = { app, orchestrator };