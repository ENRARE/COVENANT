// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CovenantHashing} from "../src/CovenantHashing.sol";
import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";

contract CovenantHashingHarness {
    function paymentIntentStruct(CovenantTypes.PaymentIntent calldata intent)
        external
        pure
        returns (bytes32)
    {
        return CovenantHashing.hashPaymentIntentStruct(intent);
    }

    function authorizationReceiptStruct(CovenantTypes.AuthorizationReceipt calldata authorization)
        external
        pure
        returns (bytes32)
    {
        return CovenantHashing.hashAuthorizationReceiptStruct(authorization);
    }

    function paymentIntentDomain(uint256 chainId, address verifyingContract)
        external
        pure
        returns (bytes32)
    {
        return CovenantHashing.domainSeparator(
            CovenantHashing.PAYMENT_INTENT_DOMAIN_NAME_HASH, chainId, verifyingContract
        );
    }

    function authorizationReceiptDomain(uint256 chainId, address verifyingContract)
        external
        pure
        returns (bytes32)
    {
        return CovenantHashing.domainSeparator(
            CovenantHashing.AUTHORIZATION_RECEIPT_DOMAIN_NAME_HASH, chainId, verifyingContract
        );
    }

    function digest(bytes32 separator, bytes32 structHash) external pure returns (bytes32) {
        return CovenantHashing.typedDataDigest(separator, structHash);
    }
}

contract CovenantHashParityTest is CovenantVaultTestBase {
    CovenantHashingHarness internal harness;

    function setUp() public override {
        super.setUp();
        harness = new CovenantHashingHarness();
    }

    function testFixedPaymentIntentStructAndDigestMatchTypeScript() public view {
        CovenantTypes.PaymentIntent memory intent = _fixtureIntent();
        bytes32 structHash = harness.paymentIntentStruct(intent);
        bytes32 separator =
            harness.paymentIntentDomain(5_042_002, 0x4000000000000000000000000000000000000004);

        assertEq(structHash, 0xc4d6004a5a72ff6ba840c5014d828e81e9e16788c2baf954f495e6b7f8b7832a);
        assertEq(separator, 0x7a1af5478e03f72ecac4236c8393fc2165719699035608183c206460166564c8);
        assertEq(
            harness.digest(separator, structHash),
            0x83aa530f535bee63287ee8f5b759f618d554290e16af53e4ca3ab44310d70a6a
        );
    }

    function testFixedAuthorizationStructAndDigestMatchTypeScript() public view {
        CovenantTypes.AuthorizationReceipt memory authorization = _fixtureAuthorization();
        bytes32 structHash = harness.authorizationReceiptStruct(authorization);
        bytes32 separator = harness.authorizationReceiptDomain(
            5_042_002, 0x4000000000000000000000000000000000000004
        );

        assertEq(structHash, 0x2479a55ed11ca406ec56959c34702ddf28f5fe9f369e7274fe5bdf396be727ee);
        assertEq(separator, 0xc79bc72a231f2f20430a2c95ddb5f16b592c201615cc98af2a4d7603d9de9ea2);
        assertEq(
            harness.digest(separator, structHash),
            0x8d0587bee7b740a10b9ea4ae96568c119f855ab45aa66ef2d7850d49f9303be4
        );
    }

    function testRuntimeDomainSeparatorsUseActualVaultChainAndAddress() public view {
        assertEq(
            vault.paymentIntentDomainSeparator(),
            harness.paymentIntentDomain(block.chainid, address(vault))
        );
        assertEq(
            vault.authorizationReceiptDomainSeparator(),
            harness.authorizationReceiptDomain(block.chainid, address(vault))
        );
        assertTrue(
            vault.paymentIntentDomainSeparator() != vault.authorizationReceiptDomainSeparator()
        );
    }

    function testRuntimeDigestsMatchPureHashing() public view {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        bytes32 intentStructHash = harness.paymentIntentStruct(intent);
        assertEq(
            vault.hashPaymentIntent(intent),
            harness.digest(vault.paymentIntentDomainSeparator(), intentStructHash)
        );

        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(6)), 1, vault.hashPaymentIntent(intent));
        bytes32 authorizationStructHash = harness.authorizationReceiptStruct(authorization);
        assertEq(
            vault.hashAuthorizationReceipt(authorization),
            harness.digest(vault.authorizationReceiptDomainSeparator(), authorizationStructHash)
        );
    }

    function testDynamicStringMutationsChangeStructHashes() public view {
        CovenantTypes.PaymentIntent memory intent = _fixtureIntent();
        bytes32 baseIntentHash = harness.paymentIntentStruct(intent);
        intent.purpose = "Changed purpose";
        assertTrue(harness.paymentIntentStruct(intent) != baseIntentHash);
        intent = _fixtureIntent();
        intent.version = "2";
        assertTrue(harness.paymentIntentStruct(intent) != baseIntentHash);

        CovenantTypes.AuthorizationReceipt memory authorization = _fixtureAuthorization();
        bytes32 baseAuthorizationHash = harness.authorizationReceiptStruct(authorization);
        authorization.policyVersion = "gpu-policy-2";
        assertTrue(harness.authorizationReceiptStruct(authorization) != baseAuthorizationHash);
    }

    function testEveryPaymentIntentFieldChangesStructHashAndDigest() public view {
        CovenantTypes.PaymentIntent memory original = _fixtureIntent();
        bytes32 originalStructHash = harness.paymentIntentStruct(original);
        bytes32 separator =
            harness.paymentIntentDomain(5_042_002, 0x4000000000000000000000000000000000000004);
        bytes32 originalDigest = harness.digest(separator, originalStructHash);

        for (uint8 field; field < 12; ++field) {
            CovenantTypes.PaymentIntent memory mutated = _fixtureIntent();
            _mutatePaymentIntent(mutated, field);
            _assertPaymentIntentFieldChanged(original, mutated, field);
            bytes32 mutatedStructHash = harness.paymentIntentStruct(mutated);
            assertNotEq(mutatedStructHash, originalStructHash, "PaymentIntent struct field omitted");
            assertNotEq(
                harness.digest(separator, mutatedStructHash),
                originalDigest,
                "PaymentIntent digest field omitted"
            );
        }
    }

    function testEveryAuthorizationReceiptFieldChangesStructHashAndDigest() public view {
        CovenantTypes.AuthorizationReceipt memory original = _fixtureAuthorization();
        bytes32 originalStructHash = harness.authorizationReceiptStruct(original);
        bytes32 separator = harness.authorizationReceiptDomain(
            5_042_002, 0x4000000000000000000000000000000000000004
        );
        bytes32 originalDigest = harness.digest(separator, originalStructHash);

        for (uint8 field; field < 11; ++field) {
            CovenantTypes.AuthorizationReceipt memory mutated = _fixtureAuthorization();
            _mutateAuthorizationReceipt(mutated, field);
            _assertAuthorizationReceiptFieldChanged(original, mutated, field);
            bytes32 mutatedStructHash = harness.authorizationReceiptStruct(mutated);
            assertNotEq(
                mutatedStructHash, originalStructHash, "AuthorizationReceipt struct field omitted"
            );
            assertNotEq(
                harness.digest(separator, mutatedStructHash),
                originalDigest,
                "AuthorizationReceipt digest field omitted"
            );
        }
    }

    function _mutatePaymentIntent(CovenantTypes.PaymentIntent memory value, uint8 field)
        private
        pure
    {
        if (field == 0) value.version = "2";
        else if (field == 1) value.intentId = bytes32(uint256(21));
        else if (field == 2) value.covenantId = bytes32(uint256(22));
        else if (field == 3) value.agentSigner = address(0x23);
        else if (field == 4) value.recipient = address(0x24);
        else if (field == 5) value.token = address(0x25);
        else if (field == 6) value.amount++;
        else if (field == 7) value.invoiceHash = bytes32(uint256(27));
        else if (field == 8) value.purpose = "Mutated purpose";
        else if (field == 9) value.createdAt++;
        else if (field == 10) value.expiresAt++;
        else value.nonce++;
    }

    function _assertPaymentIntentFieldChanged(
        CovenantTypes.PaymentIntent memory original,
        CovenantTypes.PaymentIntent memory mutated,
        uint8 field
    ) private pure {
        if (field == 0) {
            assertNotEq(original.version, mutated.version);
        } else if (field == 1) {
            assertNotEq(original.intentId, mutated.intentId);
        } else if (field == 2) {
            assertNotEq(original.covenantId, mutated.covenantId);
        } else if (field == 3) {
            assertNotEq(original.agentSigner, mutated.agentSigner);
        } else if (field == 4) {
            assertNotEq(original.recipient, mutated.recipient);
        } else if (field == 5) {
            assertNotEq(original.token, mutated.token);
        } else if (field == 6) {
            assertNotEq(original.amount, mutated.amount);
        } else if (field == 7) {
            assertNotEq(original.invoiceHash, mutated.invoiceHash);
        } else if (field == 8) {
            assertNotEq(original.purpose, mutated.purpose);
        } else if (field == 9) {
            assertNotEq(original.createdAt, mutated.createdAt);
        } else if (field == 10) {
            assertNotEq(original.expiresAt, mutated.expiresAt);
        } else {
            assertNotEq(original.nonce, mutated.nonce);
        }
    }

    function _mutateAuthorizationReceipt(
        CovenantTypes.AuthorizationReceipt memory value,
        uint8 field
    ) private pure {
        if (field == 0) {
            value.version = "2";
        } else if (field == 1) {
            value.authorizationId = bytes32(uint256(31));
        } else if (field == 2) {
            value.decisionId = bytes32(uint256(32));
        } else if (field == 3) {
            value.covenantId = bytes32(uint256(33));
        } else if (field == 4) {
            value.intentHash = bytes32(uint256(34));
        } else if (field == 5) {
            value.vaultAddress = address(0x35);
        } else if (field == 6) {
            value.chainId++;
        } else if (field == 7) {
            value.policyVersion = "gpu-policy-2";
        } else if (field == 8) {
            value.authorizationNonce++;
        } else if (field == 9) {
            value.validUntil++;
        } else {
            value.signer = address(0x3A);
        }
    }

    function _assertAuthorizationReceiptFieldChanged(
        CovenantTypes.AuthorizationReceipt memory original,
        CovenantTypes.AuthorizationReceipt memory mutated,
        uint8 field
    ) private pure {
        if (field == 0) {
            assertNotEq(original.version, mutated.version);
        } else if (field == 1) {
            assertNotEq(original.authorizationId, mutated.authorizationId);
        } else if (field == 2) {
            assertNotEq(original.decisionId, mutated.decisionId);
        } else if (field == 3) {
            assertNotEq(original.covenantId, mutated.covenantId);
        } else if (field == 4) {
            assertNotEq(original.intentHash, mutated.intentHash);
        } else if (field == 5) {
            assertNotEq(original.vaultAddress, mutated.vaultAddress);
        } else if (field == 6) {
            assertNotEq(original.chainId, mutated.chainId);
        } else if (field == 7) {
            assertNotEq(original.policyVersion, mutated.policyVersion);
        } else if (field == 8) {
            assertNotEq(original.authorizationNonce, mutated.authorizationNonce);
        } else if (field == 9) {
            assertNotEq(original.validUntil, mutated.validUntil);
        } else {
            assertNotEq(original.signer, mutated.signer);
        }
    }

    function _fixtureIntent() private pure returns (CovenantTypes.PaymentIntent memory) {
        return CovenantTypes.PaymentIntent({
            version: "1",
            intentId: 0x0202020202020202020202020202020202020202020202020202020202020202,
            covenantId: 0x0101010101010101010101010101010101010101010101010101010101010101,
            agentSigner: 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A,
            recipient: 0x6000000000000000000000000000000000000006,
            token: 0x5000000000000000000000000000000000000005,
            amount: 1_250_000,
            invoiceHash: 0x0808080808080808080808080808080808080808080808080808080808080808,
            purpose: "Purchase approved GPU compute",
            createdAt: 1_784_563_260,
            expiresAt: 1_784_563_560,
            nonce: 1
        });
    }

    function _fixtureAuthorization()
        private
        pure
        returns (CovenantTypes.AuthorizationReceipt memory)
    {
        return CovenantTypes.AuthorizationReceipt({
            version: "1",
            authorizationId: 0x0606060606060606060606060606060606060606060606060606060606060606,
            decisionId: 0x0404040404040404040404040404040404040404040404040404040404040404,
            covenantId: 0x0101010101010101010101010101010101010101010101010101010101010101,
            intentHash: 0x83aa530f535bee63287ee8f5b759f618d554290e16af53e4ca3ab44310d70a6a,
            vaultAddress: 0x4000000000000000000000000000000000000004,
            chainId: 5_042_002,
            policyVersion: "gpu-policy-1",
            authorizationNonce: 1,
            validUntil: 1_784_563_440,
            signer: 0x1563915e194D8CfBA1943570603F7606A3115508
        });
    }
}
