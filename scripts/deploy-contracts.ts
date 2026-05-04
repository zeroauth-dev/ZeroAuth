import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=========================================");
  console.log("  ZeroAuth Contract Deployment");
  console.log("  Target: Base Sepolia L2 (Chain 84532)");
  console.log("=========================================\n");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  // Deploy DIDRegistry
  console.log("[1/2] Deploying DIDRegistry...");
  const DIDRegistry = await ethers.getContractFactory("DIDRegistry");
  const didRegistry = await DIDRegistry.deploy();
  await didRegistry.waitForDeployment();
  const didRegistryAddress = await didRegistry.getAddress();
  console.log("  DIDRegistry deployed to:", didRegistryAddress);

  // Deploy Verifier (if exists)
  let verifierAddress = "";
  const verifierPath = path.join(__dirname, "..", "contracts", "Verifier.sol");
  if (fs.existsSync(verifierPath)) {
    console.log("\n[2/2] Deploying Groth16Verifier...");
    const Verifier = await ethers.getContractFactory("Groth16Verifier");
    const verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
    verifierAddress = await verifier.getAddress();
    console.log("  Groth16Verifier deployed to:", verifierAddress);
  } else {
    console.log("\n[2/2] Verifier.sol not found — skipping. Run setup-zkp.sh first.");
  }

  // Save deployed addresses
  const addresses = {
    network: "baseSepolia",
    chainId: 84532,
    deployer: deployer.address,
    contracts: {
      DIDRegistry: didRegistryAddress,
      Verifier: verifierAddress || "not deployed",
    },
    deployedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "..", "contracts", "deployed-addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log("\n  Addresses saved to:", outputPath);

  console.log("\n=========================================");
  console.log("  Deployment Complete!");
  console.log("  View on BaseScan:");
  console.log(`  https://sepolia.basescan.org/address/${didRegistryAddress}`);
  if (verifierAddress) {
    console.log(`  https://sepolia.basescan.org/address/${verifierAddress}`);
  }
  console.log("=========================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
