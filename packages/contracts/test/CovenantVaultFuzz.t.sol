// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";

contract CovenantVaultFuzzTest is CovenantVaultTestBase {
    function testFuzzValidPaymentSequenceRespectsBudgetAndCount(uint96[] memory rawAmounts) public {
        vm.assume(rawAmounts.length != 0);
        if (rawAmounts.length > 8) assembly ("memory-safe") { mstore(rawAmounts, 8) }
        CovenantTypes.Configuration memory c = _configuration();
        c.maxPaymentCount = 8;
        c.maxAmountPerPayment = 2_000_000_000;
        vault = _deployVault(c);
        token.mint(address(vault), c.totalBudget);
        uint256 expectedSpent;
        uint256 expectedCount;
        for (uint256 i; i < rawAmounts.length; ++i) {
            uint256 amount = bound(uint256(rawAmounts[i]), 1, c.maxAmountPerPayment);
            CovenantTypes.PaymentIntent memory intent =
                _intent(bytes32(i + 1_000), i + 1_000, amount);
            (
                bytes memory intentSig,
                CovenantTypes.AuthorizationReceipt memory auth,
                bytes memory authSig
            ) = _signedPayment(intent, bytes32(i + 2_000), i + 2_000);
            bool shouldSucceed =
                expectedCount < c.maxPaymentCount && amount <= c.totalBudget - expectedSpent;
            try vault.executePayment(intent, intentSig, auth, authSig) {
                assertTrue(shouldSucceed);
                expectedSpent += amount;
                expectedCount++;
            } catch {
                assertFalse(shouldSucceed);
            }
        }
        assertEq(vault.totalSpent(), expectedSpent);
        assertEq(vault.paymentCount(), expectedCount);
        assertLe(expectedSpent, c.totalBudget);
        assertLe(expectedCount, c.maxPaymentCount);
    }

    function testFuzzEveryIntentFieldMutationInvalidatesOriginalSignatures(uint8 rawField) public {
        uint8 field = uint8(bound(rawField, 0, 11));
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(3_001)), 3_001, 1);
        (
            bytes memory intentSig,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory authSig
        ) = _signedPayment(intent, bytes32(uint256(3_002)), 3_002);
        if (field == 0) intent.version = "2";
        else if (field == 1) intent.intentId = bytes32(uint256(9));
        else if (field == 2) intent.covenantId = bytes32(uint256(9));
        else if (field == 3) intent.agentSigner = attacker;
        else if (field == 4) intent.recipient = attacker;
        else if (field == 5) intent.token = attacker;
        else if (field == 6) intent.amount += 1;
        else if (field == 7) intent.invoiceHash = bytes32(uint256(9));
        else if (field == 8) intent.purpose = "mutated";
        else if (field == 9) intent.createdAt += 1;
        else if (field == 10) intent.expiresAt -= 1;
        else intent.nonce += 1;
        vm.expectRevert();
        vault.executePayment(intent, intentSig, auth, authSig);
    }

    function testFuzzEveryAuthorizationFieldMutationInvalidatesOriginalSignature(uint8 rawField)
        public
    {
        uint8 field = uint8(bound(rawField, 0, 10));
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(4_001)), 4_001, 1);
        (
            bytes memory intentSig,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory authSig
        ) = _signedPayment(intent, bytes32(uint256(4_002)), 4_002);
        if (field == 0) auth.version = "2";
        else if (field == 1) auth.authorizationId = bytes32(uint256(9));
        else if (field == 2) auth.decisionId = bytes32(uint256(9));
        else if (field == 3) auth.covenantId = bytes32(uint256(9));
        else if (field == 4) auth.intentHash = bytes32(uint256(9));
        else if (field == 5) auth.vaultAddress = attacker;
        else if (field == 6) auth.chainId += 1;
        else if (field == 7) auth.policyVersion = "mutated";
        else if (field == 8) auth.authorizationNonce += 1;
        else if (field == 9) auth.validUntil -= 1;
        else auth.signer = attacker;
        vm.expectRevert();
        vault.executePayment(intent, intentSig, auth, authSig);
    }

    function testFuzzReplayPermutationAcrossAllFiveIdentities(uint8 rawIdentity) public {
        _execute(_intent(bytes32(uint256(5_001)), 5_001, 1), bytes32(uint256(5_002)), 5_002);
        uint8 identity = uint8(bound(rawIdentity, 0, 4));
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(5_101)), 5_101, 1);
        if (identity == 1) intent.intentId = bytes32(uint256(5_001));
        if (identity == 2) intent.nonce = 5_001;
        bytes32 digest = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory auth =
            _authorization(bytes32(uint256(5_102)), 5_102, digest);
        if (identity == 0) {
            intent = _intent(bytes32(uint256(5_001)), 5_001, 1);
            digest = vault.hashPaymentIntent(intent);
            auth = _authorization(bytes32(uint256(5_102)), 5_102, digest);
        } else if (identity == 3) {
            auth.authorizationId = bytes32(uint256(5_002));
        } else if (identity == 4) {
            auth.authorizationNonce = 5_002;
        }
        bytes memory intentSig = _signature(AGENT_PRIVATE_KEY, digest);
        bytes memory authSig =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(auth));
        vm.expectRevert(CovenantVault.ReplayDetected.selector);
        vault.executePayment(intent, intentSig, auth, authSig);
    }

    function testFuzzTimestampBoundaries(uint8 rawBoundary) public {
        uint8 boundary = uint8(bound(rawBoundary, 0, 7));
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(6_001)), 6_001, 1);
        uint256 timestamp;
        if (boundary == 0) {
            timestamp = vault.validAfter() - 1;
        } else if (boundary == 1) {
            timestamp = vault.validAfter();
            intent.createdAt = vault.validAfter();
        } else if (boundary == 2) {
            timestamp = vault.validUntil() - 1;
            intent.expiresAt = vault.validUntil();
        } else if (boundary == 3) {
            timestamp = vault.validUntil();
            intent.expiresAt = vault.validUntil();
        } else if (boundary == 4) {
            timestamp = intent.expiresAt - 1;
        } else if (boundary == 5) {
            timestamp = intent.expiresAt;
        } else if (boundary == 6) {
            timestamp = 1_399;
        } else {
            timestamp = 1_400;
        }
        vm.warp(timestamp);
        bool succeeds = boundary == 1 || boundary == 2 || boundary == 4 || boundary == 6;
        bytes32 digest = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory auth =
            _authorization(bytes32(uint256(6_002)), 6_002, digest);
        if (boundary >= 2 && boundary <= 5) auth.validUntil = intent.expiresAt;
        bytes memory intentSig = _signature(AGENT_PRIVATE_KEY, digest);
        bytes memory authSig =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(auth));
        if (succeeds) {
            vault.executePayment(intent, intentSig, auth, authSig);
        } else {
            vm.expectRevert();
            vault.executePayment(intent, intentSig, auth, authSig);
        }
    }

    function testFuzzMalformedSignatureLengthBothPositions(uint8 rawLength, bool agentPosition)
        public
    {
        uint256 length = bound(uint256(rawLength), 0, 96);
        vm.assume(length != 65);
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(7_001)), 7_001, 1);
        (
            bytes memory intentSig,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory authSig
        ) = _signedPayment(intent, bytes32(uint256(7_002)), 7_002);
        bytes memory malformed = new bytes(length);
        vm.expectRevert();
        vault.executePayment(
            intent, agentPosition ? malformed : intentSig, auth, agentPosition ? authSig : malformed
        );
    }
}
