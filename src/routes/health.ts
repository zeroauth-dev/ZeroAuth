import { Router, Request, Response } from 'express';
import { isBlockchainReady, getProvider } from '../services/blockchain';
import { isZKPReady } from '../services/zkp';
import { isPoseidonReady } from '../services/identity';
import { config } from '../config';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  let blockchainStatus = 'not configured';
  let latestBlock: number | null = null;

  if (isBlockchainReady()) {
    try {
      const provider = getProvider();
      if (provider) {
        latestBlock = await provider.getBlockNumber();
        blockchainStatus = 'connected';
      }
    } catch {
      blockchainStatus = 'error';
    }
  }

  res.json({
    status: 'healthy',
    service: 'ZeroAuth',
    version: '1.0.0',
    message: 'Zero biometric data stored. Ever. Breach-proof by architecture.',
    timestamp: new Date().toISOString(),
    subsystems: {
      blockchain: {
        status: blockchainStatus,
        network: 'Base Sepolia',
        chainId: config.blockchain.chainId,
        latestBlock,
        didRegistryAddress: config.blockchain.didRegistryAddress || null,
        verifierAddress: config.blockchain.verifierAddress || null,
      },
      zkp: {
        status: isZKPReady() ? 'ready' : 'initializing',
        protocol: 'groth16',
        curve: 'bn128',
        verifyOnChain: config.blockchain.verifyOnChain,
      },
      poseidon: {
        status: isPoseidonReady() ? 'ready' : 'initializing',
      },
    },
  });
});

export default router;
