// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DIDRegistry
 * @notice Patent Module 214 — On-chain Decentralized Identity Registry
 * @dev Stores mapping of SHA-256(biometric) → DID on Base Sepolia L2.
 *      No biometric data is stored. Only the 32-byte hash.
 *
 * Patent ref: Claim 3 — "apply a hash function to the biometric data by using
 * the SHA-256 algorithm to generate a biometric identity (ID); generate a
 * decentralized identification number (DID) to be associated with the user;
 * and store a mapping value of the biometric identity (ID) to the DID."
 */
contract DIDRegistry {
    address public owner;

    // biometricIDHash (SHA-256 output) => DID string
    mapping(bytes32 => string) private _identities;
    mapping(bytes32 => bool) private _registered;
    uint256 public identityCount;

    event IdentityRegistered(
        bytes32 indexed biometricIDHash,
        string did,
        uint256 timestamp
    );

    event IdentityRevoked(
        bytes32 indexed biometricIDHash,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "DIDRegistry: caller is not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Register a new biometricID -> DID mapping
    function registerIdentity(
        bytes32 biometricIDHash,
        string calldata did
    ) external onlyOwner {
        require(biometricIDHash != bytes32(0), "Invalid biometric hash");
        require(bytes(did).length > 0, "Invalid DID");
        require(!_registered[biometricIDHash], "Already registered");

        _identities[biometricIDHash] = did;
        _registered[biometricIDHash] = true;
        identityCount++;

        emit IdentityRegistered(biometricIDHash, did, block.timestamp);
    }

    /// @notice Look up DID by biometric ID hash
    function verifyIdentity(
        bytes32 biometricIDHash
    ) external view returns (string memory) {
        require(_registered[biometricIDHash], "Not registered");
        return _identities[biometricIDHash];
    }

    /// @notice Check if identity is registered
    function isRegistered(bytes32 biometricIDHash) external view returns (bool) {
        return _registered[biometricIDHash];
    }

    /// @notice Revoke an identity
    function revokeIdentity(bytes32 biometricIDHash) external onlyOwner {
        require(_registered[biometricIDHash], "Not registered");
        delete _identities[biometricIDHash];
        _registered[biometricIDHash] = false;
        identityCount--;
        emit IdentityRevoked(biometricIDHash, block.timestamp);
    }

    /// @notice Transfer ownership
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }
}
