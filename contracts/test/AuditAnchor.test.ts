import { expect } from "chai";
import { ethers } from "hardhat";
import type { Signer } from "ethers";

// Hardhat test suite for `contracts/AuditAnchor.sol` — see C-016 in
// `docs/plan/bfsi-v1/04-commits.md` and ADR 0014
// (`adr/0014-on-chain-anchor-cadence.md`) for the contract contract spec.

describe("AuditAnchor", () => {
  // Test fixtures
  const tenantA = ethers.keccak256(ethers.toUtf8Bytes("tenant-acme|live"));
  const tenantB = ethers.keccak256(ethers.toUtf8Bytes("tenant-globex|live"));
  const day = 20260528n; // YYYYMMDD as uint64
  const terminalHash = ethers.keccak256(ethers.toUtf8Bytes("terminal-hash-A"));
  const rowCount = 1234n;

  async function deploy() {
    const [owner, other] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("AuditAnchor");
    const anchor = await factory.deploy(await owner.getAddress());
    await anchor.waitForDeployment();
    return { anchor, owner, other };
  }

  it("owner can recordAnchor and AnchorRecorded fires with the right args", async () => {
    const { anchor } = await deploy();

    await expect(anchor.recordAnchor(tenantA, day, terminalHash, rowCount))
      .to.emit(anchor, "AnchorRecorded")
      .withArgs(tenantA, day, terminalHash, rowCount);
  });

  it("non-owner cannot recordAnchor (reverts with OwnableUnauthorizedAccount)", async () => {
    const { anchor, other } = await deploy();

    await expect(
      anchor.connect(other as Signer).recordAnchor(tenantA, day, terminalHash, rowCount)
    )
      .to.be.revertedWithCustomError(anchor, "OwnableUnauthorizedAccount")
      .withArgs(await other.getAddress());
  });

  it("re-anchoring the same (tenantIdHash, dayUtc) reverts AlreadyAnchored", async () => {
    const { anchor } = await deploy();

    await anchor.recordAnchor(tenantA, day, terminalHash, rowCount);

    const expectedKey = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint64"], [tenantA, day])
    );

    await expect(
      anchor.recordAnchor(tenantA, day, terminalHash, rowCount)
    )
      .to.be.revertedWithCustomError(anchor, "AlreadyAnchored")
      .withArgs(expectedKey);
  });

  it("getAnchor returns (true, terminalHash, rowCount) after a recordAnchor", async () => {
    const { anchor } = await deploy();

    await anchor.recordAnchor(tenantA, day, terminalHash, rowCount);
    const [exists, gotHash, gotRowCount] = await anchor.getAnchor(tenantA, day);

    expect(exists).to.equal(true);
    expect(gotHash).to.equal(terminalHash);
    expect(gotRowCount).to.equal(rowCount);
  });

  it("getAnchor returns (false, 0, 0) for a key that was never anchored", async () => {
    const { anchor } = await deploy();

    const [exists, gotHash, gotRowCount] = await anchor.getAnchor(tenantA, day);

    expect(exists).to.equal(false);
    expect(gotHash).to.equal(ethers.ZeroHash);
    expect(gotRowCount).to.equal(0n);
  });

  it("two different tenantIdHash values on the same dayUtc both anchor successfully", async () => {
    const { anchor } = await deploy();

    const hashA = ethers.keccak256(ethers.toUtf8Bytes("term-A"));
    const hashB = ethers.keccak256(ethers.toUtf8Bytes("term-B"));
    const rowsA = 100n;
    const rowsB = 200n;

    await expect(anchor.recordAnchor(tenantA, day, hashA, rowsA))
      .to.emit(anchor, "AnchorRecorded")
      .withArgs(tenantA, day, hashA, rowsA);

    await expect(anchor.recordAnchor(tenantB, day, hashB, rowsB))
      .to.emit(anchor, "AnchorRecorded")
      .withArgs(tenantB, day, hashB, rowsB);

    const [existsA, returnedHashA, returnedRowsA] = await anchor.getAnchor(tenantA, day);
    const [existsB, returnedHashB, returnedRowsB] = await anchor.getAnchor(tenantB, day);

    expect(existsA).to.equal(true);
    expect(returnedHashA).to.equal(hashA);
    expect(returnedRowsA).to.equal(rowsA);

    expect(existsB).to.equal(true);
    expect(returnedHashB).to.equal(hashB);
    expect(returnedRowsB).to.equal(rowsB);
  });
});
