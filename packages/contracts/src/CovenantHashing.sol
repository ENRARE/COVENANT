// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import {CovenantTypes} from "./CovenantTypes.sol";

/// @notice Exact runtime EIP-712 mappings for the two payloads verified by CovenantVault.
library CovenantHashing {
    bytes32 internal constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant SCHEMA_VERSION_HASH = keccak256("1");
    bytes32 internal constant PAYMENT_INTENT_DOMAIN_NAME_HASH = keccak256("Covenant PaymentIntent");
    bytes32 internal constant AUTHORIZATION_RECEIPT_DOMAIN_NAME_HASH =
        keccak256("Covenant AuthorizationReceipt");

    bytes32 internal constant PAYMENT_INTENT_TYPEHASH = keccak256(
        "PaymentIntent(string version,bytes32 intentId,bytes32 covenantId,address agentSigner,address recipient,address token,uint256 amount,bytes32 invoiceHash,string purpose,uint256 createdAt,uint256 expiresAt,uint256 nonce)"
    );
    bytes32 internal constant AUTHORIZATION_RECEIPT_TYPEHASH = keccak256(
        "AuthorizationReceipt(string version,bytes32 authorizationId,bytes32 decisionId,bytes32 covenantId,bytes32 intentHash,address vaultAddress,uint256 chainId,string policyVersion,uint256 authorizationNonce,uint256 validUntil,address signer)"
    );

    function hashPaymentIntentStruct(CovenantTypes.PaymentIntent calldata intent)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PAYMENT_INTENT_TYPEHASH,
                keccak256(bytes(intent.version)),
                intent.intentId,
                intent.covenantId,
                intent.agentSigner,
                intent.recipient,
                intent.token,
                intent.amount,
                intent.invoiceHash,
                keccak256(bytes(intent.purpose)),
                intent.createdAt,
                intent.expiresAt,
                intent.nonce
            )
        );
    }

    function hashAuthorizationReceiptStruct(
        CovenantTypes.AuthorizationReceipt calldata authorization
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                AUTHORIZATION_RECEIPT_TYPEHASH,
                keccak256(bytes(authorization.version)),
                authorization.authorizationId,
                authorization.decisionId,
                authorization.covenantId,
                authorization.intentHash,
                authorization.vaultAddress,
                authorization.chainId,
                keccak256(bytes(authorization.policyVersion)),
                authorization.authorizationNonce,
                authorization.validUntil,
                authorization.signer
            )
        );
    }

    function domainSeparator(bytes32 domainNameHash, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                domainNameHash,
                SCHEMA_VERSION_HASH,
                chainId,
                verifyingContract
            )
        );
    }

    function typedDataDigest(bytes32 separator, bytes32 structHash)
        internal
        pure
        returns (bytes32)
    {
        return MessageHashUtils.toTypedDataHash(separator, structHash);
    }
}
