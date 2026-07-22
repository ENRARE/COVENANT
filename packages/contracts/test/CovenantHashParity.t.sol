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
