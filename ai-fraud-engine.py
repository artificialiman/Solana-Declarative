# AI Fraud Detection Engine for SolD Token Launches
# Real-time pattern matching and wallet reputation scoring

import asyncio
import aiohttp
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import pickle
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class WalletPattern:
    """Wallet behavior pattern for fraud detection"""
    address: str
    creation_time: datetime
    transaction_count: int
    total_volume: float
    unique_interactions: int
    token_launches: int
    quick_sells: int  # Sells within 24h of token creation
    rugpull_history: int  # Number of confirmed rugpulls
    timelock_violations: int
    social_signals: int  # GitHub, Twitter, Discord activity

@dataclass
class LaunchPattern:
    """Token launch pattern analysis"""
    token_symbol: str
    supply: int
    timelock_duration: int  # seconds
    insurance_wallets: List[str]
    creator_wallet: str
    launch_timestamp: datetime
    initial_liquidity: float
    team_allocation: float

class FraudDataCollector:
    """Collects historical fraud data for model training"""
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
        self.known_rugpulls = [
            # Known rugpull addresses from public databases
            "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",  # Squid Game Token
            "Bx7k2J8vQp3R5nM1Ks6Hf9Ld4Cv8Bn2Xr7Yq1Zw89Qm",  # SafeMoon Clone
            "FvshM7f3mUo5oErznADVxMEqC58PdK6aYVD9kSz2cHg7",  # Titan Finance
        ]
        self.legitimate_projects = [
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",  # USDC
            "So11111111111111111111111111111111111111112",   # Wrapped SOL
            "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",   # Marinade SOL
        ]
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def collect_wallet_data(self, address: str) -> WalletPattern:
        """Collect comprehensive wallet behavior data"""
        try:
            # Solscan API calls (simplified)
            account_info = await self._fetch_account_info(address)
            transactions = await self._fetch_transactions(address)
            token_accounts = await self._fetch_token_accounts(address)
            
            # Calculate fraud indicators
            pattern = WalletPattern(
                address=address,
                creation_time=self._parse_creation_time(account_info),
                transaction_count=len(transactions),
                total_volume=sum(tx.get('amount', 0) for tx in transactions),
                unique_interactions=len(set(tx.get('counterpart') for tx in transactions)),
                token_launches=self._count_token_launches(transactions),
                quick_sells=self._count_quick_sells(transactions),
                rugpull_history=1 if address in self.known_rugpulls else 0,
                timelock_violations=self._count_timelock_violations(transactions),
                social_signals=await self._get_social_signals(address)
            )
            
            return pattern
            
        except Exception as e:
            logger.error(f"Error collecting data for {address}: {e}")
            return self._default_pattern(address)
    
    async def _fetch_account_info(self, address: str) -> dict:
        """Fetch basic account information"""
        # Mock API call - replace with actual Solscan/Helius API
        await asyncio.sleep(0.1)  # Rate limiting
        return {
            "address": address,
            "lamports": 1000000000,
            "owner": "11111111111111111111111111111111",
            "executable": False,
            "rentEpoch": 361
        }
    
    async def _fetch_transactions(self, address: str, limit: int = 1000) -> List[dict]:
        """Fetch transaction history"""
        await asyncio.sleep(0.1)
        # Mock transaction data
        transactions = []
        for i in range(min(limit, 100)):  # Simulate fewer transactions
            transactions.append({
                "signature": f"tx_{i}_{address[:8]}",
                "amount": np.random.exponential(0.1) * 1000000000,  # Lamports
                "counterpart": f"wallet_{i % 20}",
                "timestamp": datetime.now() - timedelta(days=i),
                "type": "transfer"
            })
        return transactions
    
    async def _fetch_token_accounts(self, address: str) -> List[dict]:
        """Fetch token account information"""
        await asyncio.sleep(0.1)
        return []  # Simplified for MVP
    
    def _parse_creation_time(self, account_info: dict) -> datetime:
        """Estimate account creation time"""
        return datetime.now() - timedelta(days=np.random.randint(1, 1000))
    
    def _count_token_launches(self, transactions: List[dict]) -> int:
        """Count token launch transactions"""
        return sum(1 for tx in transactions if 'create' in tx.get('type', ''))
    
    def _count_quick_sells(self, transactions: List[dict]) -> int:
        """Count sells within 24h of token creation"""
        return len(transactions) // 20  # Simplified metric
    
    def _count_timelock_violations(self, transactions: List[dict]) -> int:
        """Count attempts to violate timelocks"""
        return 0  # Simplified for MVP
    
    async def _get_social_signals(self, address: str) -> int:
        """Get social media presence indicators"""
        return np.random.randint(0, 5)  # Mock social signals
    
    def _default_pattern(self, address: str) -> WalletPattern:
        """Return default pattern for failed data collection"""
        return WalletPattern(
            address=address,
            creation_time=datetime.now() - timedelta(days=1),
            transaction_count=0,
            total_volume=0.0,
            unique_interactions=0,
            token_launches=0,
            quick_sells=0,
            rugpull_history=1 if address in self.known_rugpulls else 0,
            timelock_violations=0,
            social_signals=0
        )

class FraudDetectionModel:
    """Machine learning model for fraud detection"""
    
    def __init__(self):
        self.model = IsolationForest(contamination=0.1, random_state=42)
        self.scaler = StandardScaler()
        self.is_trained = False
        self.feature_names = [
            'transaction_count', 'total_volume', 'unique_interactions',
            'token_launches', 'quick_sells', 'rugpull_history',
            'timelock_violations', 'social_signals', 'account_age_days',
            'avg_transaction_size', 'interaction_diversity'
        ]
    
    def extract_features(self, pattern: WalletPattern) -> np.ndarray:
        """Extract numerical features from wallet pattern"""
        account_age = (datetime.now() - pattern.creation_time).days
        avg_tx_size = pattern.total_volume / max(pattern.transaction_count, 1)
        interaction_diversity = pattern.unique_interactions / max(pattern.transaction_count, 1)
        
        features = np.array([
            pattern.transaction_count,
            pattern.total_volume,
            pattern.unique_interactions,
            pattern.token_launches,
            pattern.quick_sells,
            pattern.rugpull_history,
            pattern.timelock_violations,
            pattern.social_signals,
            account_age,
            avg_tx_size,
            interaction_diversity
        ])
        
        return features.reshape(1, -1)
    
    def train(self, patterns: List[WalletPattern]) -> None:
        """Train the fraud detection model"""
        logger.info(f"Training model with {len(patterns)} wallet patterns")
        
        # Extract features
        feature_matrix = []
        for pattern in patterns:
            features = self.extract_features(pattern)
            feature_matrix.append(features.flatten())
        
        X = np.array(feature_matrix)
        
        # Scale features
        X_scaled = self.scaler.fit_transform(X)
        
        # Train isolation forest
        self.model.fit(X_scaled)
        self.is_trained = True
        
        logger.info("Model training completed")
    
    def predict_fraud_score(self, pattern: WalletPattern) -> float:
        """Predict fraud score (0.0 = legitimate, 1.0 = definite fraud)"""
        if not self.is_trained:
            # Fallback to rule-based scoring
            return self._rule_based_score(pattern)
        
        features = self.extract_features(pattern)
        features_scaled = self.scaler.transform(features)
        
        # Get anomaly score (-1 to 1, where -1 is most anomalous)
        anomaly_score = self.model.decision_function(features_scaled)[0]
        
        # Convert to fraud probability (0 to 1)
        fraud_score = max(0.0, min(1.0, (1 - anomaly_score) / 2))
        
        return fraud_score
    
    def _rule_based_score(self, pattern: WalletPattern) -> float:
        """Fallback rule-based scoring when model not trained"""
        score = 0.0
        
        # Known rugpull history
        if pattern.rugpull_history > 0:
            score += 0.8
        
        # Quick sell behavior
        if pattern.quick_sells > pattern.token_launches * 0.5:
            score += 0.3
        
        # Low social signals
        if pattern.social_signals == 0:
            score += 0.2
        
        # High timelock violations
        if pattern.timelock_violations > 0:
            score += 0.4
        
        # New account with high activity
        account_age = (datetime.now() - pattern.creation_time).days
        if account_age < 30 and pattern.transaction_count > 100:
            score += 0.3
        
        return min(1.0, score)
    
    def save_model(self, filepath: str) -> None:
        """Save trained model to disk"""
        model_data = {
            'model': self.model,
            'scaler': self.scaler,
            'is_trained': self.is_trained,
            'feature_names': self.feature_names
        }
        with open(filepath, 'wb') as f:
            pickle.dump(model_data, f)
    
    def load_model(self, filepath: str) -> None:
        """Load trained model from disk"""
        with open(filepath, 'rb') as f:
            model_data = pickle.load(f)
        
        self.model = model_data['model']
        self.scaler = model_data['scaler']
        self.is_trained = model_data['is_trained']
        self.feature_names = model_data['feature_names']

class LaunchAnalyzer:
    """Analyzes token launch parameters for fraud indicators"""
    
    def __init__(self, fraud_model: FraudDetectionModel):
        self.fraud_model = fraud_model
    
    async def analyze_launch(self, launch_config: dict) -> dict:
        """Comprehensive analysis of token launch configuration"""
        analysis = {
            'fraud_score': 0.0,
            'risk_factors': [],
            'recommendations': [],
            'wallet_scores': {}
        }
        
        # Analyze creator wallet
        creator_score = await self._analyze_wallet(launch_config.get('creator_wallet', ''))
        analysis['wallet_scores']['creator'] = creator_score
        analysis['fraud_score'] += creator_score * 0.4  # 40% weight
        
        # Analyze insurance wallets
        insurance_wallets = launch_config.get('insurance_wallets', [])
        for i, wallet in enumerate(insurance_wallets):
            wallet_score = await self._analyze_wallet(wallet)
            analysis['wallet_scores'][f'insurance_{i}'] = wallet_score
            analysis['fraud_score'] += wallet_score * (0.3 / len(insurance_wallets))
        
        # Analyze launch parameters
        param_score = self._analyze_parameters(launch_config)
        analysis['fraud_score'] += param_score * 0.3  # 30% weight
        
        # Normalize final score
        analysis['fraud_score'] = min(1.0, analysis['fraud_score'])
        
        # Generate risk factors and recommendations
        self._generate_risk_assessment(launch_config, analysis)
        
        return analysis
    
    async def _analyze_wallet(self, address: str) -> float:
        """Analyze individual wallet for fraud indicators"""
        if not address:
            return 0.5  # Unknown wallet gets medium risk
        
        async with FraudDataCollector() as collector:
            pattern = await collector.collect_wallet_data(address)
            return self.fraud_model.predict_fraud_score(pattern)
    
    def _analyze_parameters(self, config: dict) -> float:
        """Analyze launch parameters for red flags"""
        score = 0.0
        
        # Token supply analysis
        supply = int(config.get('supply', 0))
        if supply > 1000000000000:  # > 1 trillion
            score += 0.3
        
        # Timelock analysis
        timelock_days = config.get('timelock_duration', 0) // 86400
        if timelock_days < 100:  # Below minimum
            score += 0.5
        elif timelock_days < 200:  # Barely acceptable
            score += 0.2
        
        # Insurance wallet count
        insurance_count = len(config.get('insurance_wallets', []))
        if insurance_count > 5:  # Too many bailout options
            score += 0.3
        elif insurance_count == 0:  # No insurance
            score += 0.4
        
        # Fee analysis
        launch_fee = float(config.get('launch_fee', 0))
        expected_fee = 0.01 + (insurance_count * 0.01)
        if launch_fee < expected_fee * 0.9:  # Trying to underpay
            score += 0.3
        
        return min(1.0, score)
    
    def _generate_risk_assessment(self, config: dict, analysis: dict) -> None:
        """Generate human-readable risk factors and recommendations"""
        score = analysis['fraud_score']
        
        # Risk factors
        if score > 0.7:
            analysis['risk_factors'].append("High fraud probability detected")
        if score > 0.5:
            analysis['risk_factors'].append("Multiple red flags identified")
        
        # Wallet-specific risks
        for wallet_id, wallet_score in analysis['wallet_scores'].items():
            if wallet_score > 0.6:
                analysis['risk_factors'].append(f"Suspicious {wallet_id} wallet behavior")
        
        # Parameter risks
        timelock_days = config.get('timelock_duration', 0) // 86400
        if timelock_days < 100:
            analysis['risk_factors'].append("Timelock below minimum safety threshold")
        
        insurance_count = len(config.get('insurance_wallets', []))
        if insurance_count > 3:
            analysis['risk_factors'].append("Excessive number of insurance wallets")
        
        # Recommendations
        if score > 0.8:
            analysis['recommendations'].append("REJECT: High fraud risk")
        elif score > 0.6:
            analysis['recommendations'].append("CAUTION: Require additional verification")
        elif score > 0.4:
            analysis['recommendations'].append("MONITOR: Watch for suspicious activity")
        else:
            analysis['recommendations'].append("APPROVE: Low fraud risk")

# FastAPI Web Service
app = FastAPI(title="SolD Fraud Detection API", version="1.0.0")

# Global model instance
fraud_model = FraudDetectionModel()
launch_analyzer = LaunchAnalyzer(fraud_model)

class LaunchRequest(BaseModel):
    creator_wallet: str
    insurance_wallets: List[str] = []
    supply: str = "1000000"
    timelock_duration: int = 8640000  # 100 days in seconds
    launch_fee: str = "0.01"
    network: str = "DEVNET"

class FraudResponse(BaseModel):
    fraud_score: float
    risk_level: str
    risk_factors: List[str]
    recommendations: List[str]
    wallet_scores: Dict[str, float]
    processing_time_ms: int

@app.on_startup
async def startup_event():
    """Initialize the fraud detection model on startup"""
    logger.info("Starting fraud detection service...")
    
    # Load pre-trained model or train with mock data
    try:
        fraud_model.load_model("fraud_model.pkl")
        logger.info("Loaded pre-trained fraud model")
    except FileNotFoundError:
        logger.info("Training new fraud model with mock data...")
        await train_initial_model()

async def train_initial_model():
    """Train initial model with mock data"""
    patterns = []
    
    async with FraudDataCollector() as collector:
        # Add known rugpull patterns
        for address in collector.known_rugpulls:
            pattern = await collector.collect_wallet_data(address)
            patterns.append(pattern)
        
        # Add legitimate project patterns
        for address in collector.legitimate_projects:
            pattern = await collector.collect_wallet_data(address)
            patterns.append(pattern)
        
        # Generate additional synthetic patterns
        for i in range(50):
            fake_address = f"mock_wallet_{i:08d}"
            pattern = await collector.collect_wallet_data(fake_address)
            patterns.append(pattern)
    
    fraud_model.train(patterns)
    fraud_model.save_model("fraud_model.pkl")
    logger.info("Initial model training completed")

@app.post("/analyze-launch", response_model=FraudResponse)
async def analyze_launch_endpoint(request: LaunchRequest):
    """Analyze token launch for fraud indicators"""
    start_time = datetime.now()
    
    try:
        # Convert request to analysis format
        config = {
            'creator_wallet': request.creator_wallet,
            'insurance_wallets': request.insurance_wallets,
            'supply': request.supply,
            'timelock_duration': request.timelock_duration,
            'launch_fee': request.launch_fee
        }
        
        # Perform analysis
        analysis = await launch_analyzer.analyze_launch(config)
        
        # Determine risk level
        score = analysis['fraud_score']
        if score > 0.8:
            risk_level = "CRITICAL"
        elif score > 0.6:
            risk_level = "HIGH"
        elif score > 0.4:
            risk_level = "MEDIUM"
        elif score > 0.2:
            risk_level = "LOW"
        else:
            risk_level = "MINIMAL"
        
        processing_time = int((datetime.now() - start_time).total_seconds() * 1000)
        
        return FraudResponse(
            fraud_score=analysis['fraud_score'],
            risk_level=risk_level,
            risk_factors=analysis['risk_factors'],
            recommendations=analysis['recommendations'],
            wallet_scores=analysis['wallet_scores'],
            processing_time_ms=processing_time
        )
        
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model_trained": fraud_model.is_trained,
        "timestamp": datetime.now().isoformat()
    }

@app.post("/retrain")
async def retrain_model():
    """Retrain the fraud detection model"""
    try:
        await train_initial_model()
        return {"status": "Model retrained successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Retraining failed: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)