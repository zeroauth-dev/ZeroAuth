// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AuditAnchor
 * @notice Write-once daily on-chain anchor of the per-tenant audit-event hash
 *         chain terminal hash. Lets a bank's auditor independently prove the
 *         chain existed at a point in time and has not been re-written since,
 *         without trusting any ZeroAuth process.
 * @dev    Implements the contract surface specified in ADR 0014
 *         (`adr/0014-on-chain-anchor-cadence.md`). Lands with C-016 from
 *         `docs/plan/bfsi-v1/04-commits.md`.
 *
 *         Authorisation: only the contract owner — the signer wallet held by
 *         the anchor-cron worker — may record anchors. Ownership transfer is
 *         inherited from OpenZeppelin `Ownable`.
 *
 *         Storage layout: the `anchored` boolean mapping is the write-once
 *         flag, and `_records` carries the payload needed to reconstruct the
 *         anchor off-chain. The key is `keccak256(tenantIdHash, dayUtc)`.
 *
 *         No biometric or PII-derived data is accepted by this contract.
 *         `tenantIdHash` is itself a hash, per ADR 0014.
 */
contract AuditAnchor is Ownable {
    struct AnchorRecord {
        bytes32 tenantIdHash;
        uint64 dayUtc;
        bytes32 terminalHash;
        uint64 rowCountAtAnchor;
    }

    /// @notice Write-once flag keyed on `keccak256(tenantIdHash, dayUtc)`.
    mapping(bytes32 => bool) public anchored;

    /// @dev Payload mapping keyed on the same composite key as `anchored`.
    mapping(bytes32 => AnchorRecord) private _records;

    /// @notice Emitted on every successful `recordAnchor` call.
    event AnchorRecorded(
        bytes32 indexed tenantIdHash,
        uint64 indexed dayUtc,
        bytes32 terminalHash,
        uint64 rowCountAtAnchor
    );

    /// @notice Thrown when a caller tries to re-anchor an existing (tenant, day) key.
    error AlreadyAnchored(bytes32 key);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Record the terminal hash of a tenant's audit chain for a given UTC day.
    /// @dev    Write-once: the second attempt for the same (tenantIdHash, dayUtc)
    ///         reverts with `AlreadyAnchored(key)`.
    /// @param  tenantIdHash      keccak256(tenant_id || environment).
    /// @param  dayUtc            YYYYMMDD as uint64 in UTC.
    /// @param  terminalHash      SHA-256 of the last `audit_events` row in the day window.
    /// @param  rowCountAtAnchor  Number of rows the hash was computed across.
    function recordAnchor(
        bytes32 tenantIdHash,
        uint64 dayUtc,
        bytes32 terminalHash,
        uint64 rowCountAtAnchor
    ) external onlyOwner {
        bytes32 key = _anchorKey(tenantIdHash, dayUtc);
        if (anchored[key]) {
            revert AlreadyAnchored(key);
        }

        anchored[key] = true;
        _records[key] = AnchorRecord({
            tenantIdHash: tenantIdHash,
            dayUtc: dayUtc,
            terminalHash: terminalHash,
            rowCountAtAnchor: rowCountAtAnchor
        });

        emit AnchorRecorded(tenantIdHash, dayUtc, terminalHash, rowCountAtAnchor);
    }

    /// @notice Retrieve a previously recorded anchor.
    /// @return exists            True when the (tenantIdHash, dayUtc) anchor is on-chain.
    /// @return terminalHash      The recorded terminal hash, or zero when absent.
    /// @return rowCountAtAnchor  The recorded row count, or zero when absent.
    function getAnchor(
        bytes32 tenantIdHash,
        uint64 dayUtc
    )
        external
        view
        returns (bool exists, bytes32 terminalHash, uint64 rowCountAtAnchor)
    {
        bytes32 key = _anchorKey(tenantIdHash, dayUtc);
        if (!anchored[key]) {
            return (false, bytes32(0), 0);
        }
        AnchorRecord storage rec = _records[key];
        return (true, rec.terminalHash, rec.rowCountAtAnchor);
    }

    /// @dev Composite key used by both the `anchored` flag and `_records` payload.
    function _anchorKey(bytes32 tenantIdHash, uint64 dayUtc) internal pure returns (bytes32) {
        return keccak256(abi.encode(tenantIdHash, dayUtc));
    }
}
