// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Frozen MVP ABI types shared by the vault and its hashing library.
library CovenantTypes {
    struct Configuration {
        bytes32 covenantId;
        address issuer;
        address agentSigner;
        address authorizationSigner;
        address token;
        address recipient;
        uint256 maxAmountPerPayment;
        uint256 totalBudget;
        uint256 maxPaymentCount;
        uint256 validAfter;
        uint256 validUntil;
        string purpose;
        bytes32 policyHash;
        string policyVersion;
    }

    struct PaymentIntent {
        string version;
        bytes32 intentId;
        bytes32 covenantId;
        address agentSigner;
        address recipient;
        address token;
        uint256 amount;
        bytes32 invoiceHash;
        string purpose;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 nonce;
    }

    struct AuthorizationReceipt {
        string version;
        bytes32 authorizationId;
        bytes32 decisionId;
        bytes32 covenantId;
        bytes32 intentHash;
        address vaultAddress;
        uint256 chainId;
        string policyVersion;
        uint256 authorizationNonce;
        uint256 validUntil;
        address signer;
    }
}
