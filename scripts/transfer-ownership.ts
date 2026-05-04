/**
 * scripts/transfer-ownership.ts
 *
 * One-time helper to rotate the DIDRegistry deployer wallet.
 *
 * Prerequisites:
 *   - .env contains BLOCKCHAIN_PRIVATE_KEY of the CURRENT owner.
 *   - Set NEW_OWNER_ADDRESS in .env or pass as the first argv.
 *
 * Usage:
 *   npx tsx scripts/transfer-ownership.ts 0xNEW_OWNER_ADDRESS
 *
 * After this prints "Ownership transferred", swap BLOCKCHAIN_PRIVATE_KEY in
 * .env to the new owner's key. The contract will accept registerIdentity()
 * calls from the new key only after this transaction confirms.
 */

import { ethers } from 'ethers';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DID_REGISTRY_ABI = [
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner) external',
];

async function main(): Promise<void> {
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL;
  const oldKey = process.env.BLOCKCHAIN_PRIVATE_KEY;
  const registry = process.env.DID_REGISTRY_ADDRESS;
  const newOwner = process.argv[2] ?? process.env.NEW_OWNER_ADDRESS;

  if (!rpcUrl || !oldKey || !registry) {
    throw new Error('BLOCKCHAIN_RPC_URL, BLOCKCHAIN_PRIVATE_KEY, and DID_REGISTRY_ADDRESS must be set in .env');
  }
  if (!newOwner || !ethers.isAddress(newOwner)) {
    throw new Error('Pass the new owner address as argv[1] or set NEW_OWNER_ADDRESS in .env');
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(oldKey, provider);
  const contract = new ethers.Contract(registry, DID_REGISTRY_ABI, wallet);

  const currentOwner = await contract.owner();
  if (currentOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Wallet ${wallet.address} is not the current owner (${currentOwner}).`);
  }
  if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
    console.log(`No-op: ${newOwner} is already the owner.`);
    return;
  }

  console.log(`Transferring DIDRegistry ownership: ${currentOwner} → ${newOwner}`);
  const tx = await contract.transferOwnership(newOwner);
  console.log(`tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt?.blockNumber}. Ownership transferred.`);
  console.log(`Now swap BLOCKCHAIN_PRIVATE_KEY in .env to the new owner's key.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
