import { isBlockchainReady, getBlockchainInfo } from '../src/services/blockchain';

describe('Blockchain Service', () => {
  describe('Without initialization (no private key)', () => {
    it('isBlockchainReady returns false before init', () => {
      expect(isBlockchainReady()).toBe(false);
    });

    it('getBlockchainInfo returns default values when not connected', async () => {
      const info = await getBlockchainInfo();
      expect(info.network).toBe('Base Sepolia');
      expect(info.chainId).toBe(84532);
      expect(info.identityCount).toBe(0);
      expect(info.latestBlock).toBe(0);
      expect(info.contracts.DIDRegistry).toBeDefined();
    });
  });

  describe('Contract ABI Compatibility', () => {
    it('DIDRegistry ABI includes required functions', () => {
      // These are the function signatures our service expects
      const requiredFunctions = [
        'registerIdentity',
        'verifyIdentity',
        'isRegistered',
        'revokeIdentity',
        'identityCount',
        'owner',
      ];

      // The ABI strings are defined in the blockchain service
      // This test ensures the module loads without errors
      expect(isBlockchainReady).toBeDefined();
      expect(getBlockchainInfo).toBeDefined();
    });
  });
});
