// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CovenantVaultTest is CovenantVaultTestBase {
    function testConstructorStoresApprovedConfigurationIndependentOfDeployer() public view {
        assertEq(vault.covenantId(), COVENANT_ID);
        assertEq(vault.issuer(), issuer);
        assertTrue(vault.issuer() != deployer);
        assertEq(vault.agentSigner(), agentSigner);
        assertEq(vault.authorizationSigner(), authorizationSigner);
        assertEq(address(vault.token()), address(token));
        assertEq(vault.recipient(), recipient);
        assertEq(vault.purposeHash(), keccak256(bytes(PURPOSE)));
        assertEq(vault.policyVersionHash(), keccak256(bytes(POLICY_VERSION)));
        assertEq(vault.policyHash(), POLICY_HASH);
    }

    function testConstructorRejectsWrongChain() public {
        CovenantTypes.Configuration memory configuration = _configuration();
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.WrongChain.selector, 1));
        new CovenantVault(configuration);
    }

    function testConstructorRejectsZeroAddressesRoleCollisionsAndInvalidLimits() public {
        CovenantTypes.Configuration memory configuration = _configuration();
        configuration.issuer = address(0);
        vm.expectRevert(CovenantVault.ZeroAddress.selector);
        new CovenantVault(configuration);

        configuration = _configuration();
        configuration.authorizationSigner = configuration.agentSigner;
        vm.expectRevert(CovenantVault.InvalidConfiguration.selector);
        new CovenantVault(configuration);

        configuration = _configuration();
        configuration.recipient = configuration.token;
        vm.expectRevert(CovenantVault.InvalidConfiguration.selector);
        new CovenantVault(configuration);

        configuration = _configuration();
        configuration.maxAmountPerPayment = configuration.totalBudget + 1;
        vm.expectRevert(CovenantVault.InvalidConfiguration.selector);
        new CovenantVault(configuration);

        configuration = _configuration();
        configuration.validUntil = configuration.validAfter;
        vm.expectRevert(CovenantVault.InvalidConfiguration.selector);
        new CovenantVault(configuration);
    }

    function testFundIsIssuerOnlyPositiveAndDoesNotChangeBudget() public {
        uint256 frozenBudget = vault.totalBudget();
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.UnauthorizedCaller.selector, attacker));
        vm.prank(attacker);
        vault.fund(1);

        vm.expectRevert(CovenantVault.ZeroAmount.selector);
        vm.prank(issuer);
        vault.fund(0);

        vm.expectEmit(true, false, false, true, address(vault));
        emit CovenantVault.CovenantFunded(issuer, 5_000_000_000);
        vm.prank(issuer);
        vault.fund(5_000_000_000);
        assertEq(token.balanceOf(address(vault)), 15_000_000_000);
        assertEq(vault.totalBudget(), frozenBudget);

        token.mint(address(vault), 1_000_000);
        assertEq(vault.totalBudget(), frozenBudget);
    }

    function testExecutePaymentUsesExactConfiguredFieldsAndUpdatesAccounting() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        uint256 recipientBefore = token.balanceOf(recipient);

        vm.expectEmit(true, true, true, true, address(vault));
        emit CovenantVault.PaymentExecuted(
            COVENANT_ID,
            intent.intentId,
            intentHash,
            bytes32(uint256(6)),
            bytes32(uint256(4)),
            1,
            recipient,
            intent.amount,
            intent.amount,
            1
        );
        _execute(intent, bytes32(uint256(6)), 1);

        assertEq(token.balanceOf(recipient) - recipientBefore, intent.amount);
        assertEq(vault.totalSpent(), intent.amount);
        assertEq(vault.paymentCount(), 1);
        assertTrue(vault.usedIntentHashes(intentHash));
        assertTrue(vault.usedIntentIds(intent.intentId));
        assertTrue(vault.usedAgentNonces(intent.nonce));
        assertTrue(vault.usedAuthorizationIds(bytes32(uint256(6))));
        assertTrue(vault.usedAuthorizationNonces(1));
    }

    function testPermissionlessCallerCanExecuteButCannotForgeAuthorization() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(6)), 1);

        vm.prank(attacker);
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);

        CovenantTypes.PaymentIntent memory second = _intent(bytes32(uint256(3)), 2, 1_250_000);
        bytes32 secondHash = vault.hashPaymentIntent(second);
        authorization = _authorization(bytes32(uint256(7)), 2, secondHash);
        intentSignature = _signature(AGENT_PRIVATE_KEY, secondHash);
        authorizationSignature =
            _signature(ATTACKER_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));

        vm.expectRevert();
        vm.prank(attacker);
        vault.executePayment(second, intentSignature, authorization, authorizationSignature);
    }

    function testRejectsWrongAgentAndAuthorizationSignatures() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(6)), 1, intentHash);
        bytes memory authorizationSignature =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));

        address recoveredAttacker = vm.addr(ATTACKER_PRIVATE_KEY);
        bytes memory attackerIntentSignature = _signature(ATTACKER_PRIVATE_KEY, intentHash);
        vm.expectRevert(
            abi.encodeWithSelector(CovenantVault.InvalidAgentSignature.selector, recoveredAttacker)
        );
        vault.executePayment(intent, attackerIntentSignature, authorization, authorizationSignature);

        bytes memory agentIntentSignature = _signature(AGENT_PRIVATE_KEY, intentHash);
        bytes memory attackerAuthorizationSignature =
            _signature(ATTACKER_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));
        vm.expectRevert(
            abi.encodeWithSelector(
                CovenantVault.InvalidAuthorizationSignature.selector, recoveredAttacker
            )
        );
        vault.executePayment(
            intent, agentIntentSignature, authorization, attackerAuthorizationSignature
        );
    }

    function testRejectsHighSTwinsForBothSignatures() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(6)), 1);

        vm.expectPartialRevert(ECDSA.ECDSAInvalidSignatureS.selector);
        vault.executePayment(
            intent, _highSTwin(intentSignature), authorization, authorizationSignature
        );

        vm.expectPartialRevert(ECDSA.ECDSAInvalidSignatureS.selector);
        vault.executePayment(
            intent, intentSignature, authorization, _highSTwin(authorizationSignature)
        );
    }

    function testRejectsNon65ByteAndInvalidVSignatures() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        (
            ,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(6)), 1);

        vm.expectPartialRevert(ECDSA.ECDSAInvalidSignatureLength.selector);
        vault.executePayment(intent, hex"12", authorization, authorizationSignature);

        bytes memory invalidV =
            abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(1)), uint8(29));
        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        vault.executePayment(intent, invalidV, authorization, authorizationSignature);
    }

    function testRejectsIntentFieldMismatchesAndLimits() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);

        intent.version = "2";
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        intent.covenantId = bytes32(uint256(99));
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        intent.agentSigner = attacker;
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        intent.recipient = attacker;
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        intent.token = attacker;
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        intent.purpose = "Changed";
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 0);
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, vault.maxAmountPerPayment() + 1);
        _expectInvalidIntent(intent);
    }

    function testRejectsAuthorizationFieldMismatches() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        bytes memory intentSignature = _signature(AGENT_PRIVATE_KEY, intentHash);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(6)), 1, intentHash);

        authorization.version = "2";
        _expectInvalidAuthorization(intent, intentSignature, authorization);
        authorization = _authorization(bytes32(uint256(6)), 1, intentHash);
        authorization.decisionId = bytes32(0);
        _expectInvalidAuthorization(intent, intentSignature, authorization);
        authorization = _authorization(bytes32(uint256(6)), 1, intentHash);
        authorization.covenantId = bytes32(uint256(99));
        _expectInvalidAuthorization(intent, intentSignature, authorization);
        authorization = _authorization(bytes32(uint256(6)), 1, bytes32(uint256(99)));
        _expectInvalidAuthorization(intent, intentSignature, authorization);
        authorization = _authorization(bytes32(uint256(6)), 1, intentHash);
        authorization.vaultAddress = attacker;
        _expectInvalidAuthorization(intent, intentSignature, authorization);
        authorization = _authorization(bytes32(uint256(6)), 1, intentHash);
        authorization.chainId = 1;
        _expectInvalidAuthorization(intent, intentSignature, authorization);
        authorization = _authorization(bytes32(uint256(6)), 1, intentHash);
        authorization.policyVersion = "gpu-policy-2";
        _expectInvalidAuthorization(intent, intentSignature, authorization);
        authorization = _authorization(bytes32(uint256(6)), 1, intentHash);
        authorization.signer = attacker;
        _expectInvalidAuthorization(intent, intentSignature, authorization);
    }

    function testExactTimestampBoundaries() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);

        vm.warp(vault.validAfter() - 1);
        _expectExecutionRevert(
            CovenantVault.CovenantNotActive.selector, intent, bytes32(uint256(6)), 1
        );

        vm.warp(vault.validAfter());
        intent.createdAt = vault.validAfter();
        _execute(intent, bytes32(uint256(6)), 1);

        CovenantVault secondVault = _deployVault(_configuration());
        vault = secondVault;
        vm.warp(vault.validUntil());
        _expectExecutionRevert(
            CovenantVault.CovenantNotActive.selector,
            _intent(bytes32(uint256(3)), 2, 1),
            bytes32(uint256(7)),
            2
        );
    }

    function testRejectsAtIntentAndAuthorizationExpiryAndInvalidRelationships() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        vm.warp(intent.expiresAt);
        _expectInvalidIntent(intent);

        vm.warp(1_100);
        intent.createdAt = 999;
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        intent.expiresAt = intent.createdAt;
        _expectInvalidIntent(intent);
        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        intent.expiresAt = vault.validUntil() + 1;
        _expectInvalidIntent(intent);

        intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        bytes memory intentSignature = _signature(AGENT_PRIVATE_KEY, intentHash);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(6)), 1, intentHash);
        vm.warp(authorization.validUntil);
        _expectInvalidAuthorization(intent, intentSignature, authorization);

        vm.warp(1_100);
        authorization.validUntil = intent.expiresAt + 1;
        _expectInvalidAuthorization(intent, intentSignature, authorization);
    }

    function testReplayProtectionCoversEveryFrozenIdentity() public {
        CovenantTypes.PaymentIntent memory first = _intent(bytes32(uint256(2)), 1, 1_000_000);
        _execute(first, bytes32(uint256(6)), 1);

        _expectExecutionRevert(CovenantVault.ReplayDetected.selector, first, bytes32(uint256(7)), 2);

        CovenantTypes.PaymentIntent memory reusedId = _intent(first.intentId, 2, 2_000_000);
        _expectExecutionRevert(
            CovenantVault.ReplayDetected.selector, reusedId, bytes32(uint256(7)), 2
        );

        CovenantTypes.PaymentIntent memory reusedAgentNonce =
            _intent(bytes32(uint256(3)), first.nonce, 2_000_000);
        _expectExecutionRevert(
            CovenantVault.ReplayDetected.selector, reusedAgentNonce, bytes32(uint256(7)), 2
        );

        CovenantTypes.PaymentIntent memory second = _intent(bytes32(uint256(3)), 2, 2_000_000);
        _expectExecutionRevert(
            CovenantVault.ReplayDetected.selector, second, bytes32(uint256(6)), 2
        );

        _expectExecutionRevert(
            CovenantVault.ReplayDetected.selector, second, bytes32(uint256(7)), 1
        );
    }

    function testChangingSignatureBytesCannotBypassConsumedDigestOrNonce() public {
        CovenantTypes.PaymentIntent memory first = _intent(bytes32(uint256(2)), 1, 1_000_000);
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(first, bytes32(uint256(6)), 1);
        vault.executePayment(first, intentSignature, authorization, authorizationSignature);

        vm.expectPartialRevert(ECDSA.ECDSAInvalidSignatureS.selector);
        vault.executePayment(
            first, _highSTwin(intentSignature), authorization, authorizationSignature
        );
        assertEq(vault.paymentCount(), 1);

        CovenantTypes.PaymentIntent memory changedDigest =
            _intent(bytes32(uint256(3)), first.nonce, 2_000_000);
        _expectExecutionRevert(
            CovenantVault.ReplayDetected.selector, changedDigest, bytes32(uint256(7)), 2
        );
        assertEq(vault.paymentCount(), 1);
    }

    function testBudgetAndPaymentCountRemainBounded() public {
        _execute(_intent(bytes32(uint256(2)), 1, 5_000_000_000), bytes32(uint256(6)), 1);
        _execute(_intent(bytes32(uint256(3)), 2, 5_000_000_000), bytes32(uint256(7)), 2);

        _expectExecutionRevert(
            CovenantVault.PaymentCountExceeded.selector,
            _intent(bytes32(uint256(4)), 3, 1),
            bytes32(uint256(8)),
            3
        );
        assertEq(vault.totalSpent(), vault.totalBudget());
        assertEq(vault.paymentCount(), vault.maxPaymentCount());
    }

    function testRemainingBudgetUsesSubtractionWithoutOverflow() public {
        CovenantTypes.Configuration memory configuration = _configuration();
        configuration.maxAmountPerPayment = type(uint256).max;
        configuration.totalBudget = type(uint256).max;
        configuration.maxPaymentCount = 2;
        vault = _deployVault(configuration);
        token.mint(address(vault), 10);

        _execute(_intent(bytes32(uint256(2)), 1, 6), bytes32(uint256(6)), 1);
        _expectExecutionRevert(
            CovenantVault.TotalBudgetExceeded.selector,
            _intent(bytes32(uint256(3)), 2, type(uint256).max),
            bytes32(uint256(7)),
            2
        );
    }

    function testRevocationIsIssuerOnlyIrreversibleAndBlocksPayments() public {
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.UnauthorizedCaller.selector, attacker));
        vm.prank(attacker);
        vault.revoke();

        vm.expectEmit(true, false, false, false, address(vault));
        emit CovenantVault.CovenantRevoked(issuer);
        vm.prank(issuer);
        vault.revoke();
        assertTrue(vault.revoked());

        vm.expectRevert(CovenantVault.CovenantAlreadyRevoked.selector);
        vm.prank(issuer);
        vault.revoke();

        _expectExecutionRevert(
            CovenantVault.CovenantIsRevoked.selector,
            _intent(bytes32(uint256(2)), 1, 1),
            bytes32(uint256(6)),
            1
        );
    }

    function testWithdrawalOnlyAfterRevocationOrExpiryAndNeverChangesSpent() public {
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.UnauthorizedCaller.selector, attacker));
        vm.prank(attacker);
        vault.withdrawRemaining();

        vm.expectRevert(CovenantVault.WithdrawalUnavailable.selector);
        vm.prank(issuer);
        vault.withdrawRemaining();

        _execute(_intent(bytes32(uint256(2)), 1, 1_000_000), bytes32(uint256(6)), 1);
        uint256 spentBefore = vault.totalSpent();
        uint256 issuerBefore = token.balanceOf(issuer);
        vm.prank(issuer);
        vault.revoke();
        uint256 withdrawalAmount = token.balanceOf(address(vault));
        vm.expectEmit(true, false, false, true, address(vault));
        emit CovenantVault.RemainingFundsWithdrawn(issuer, withdrawalAmount);
        vm.prank(issuer);
        vault.withdrawRemaining();
        assertEq(vault.totalSpent(), spentBefore);
        assertEq(token.balanceOf(address(vault)), 0);
        assertGt(token.balanceOf(issuer), issuerBefore);

        CovenantVault expiredVault = _deployVault(_configuration());
        token.mint(address(expiredVault), 123);
        vm.warp(expiredVault.validUntil());
        vm.prank(issuer);
        expiredVault.withdrawRemaining();
        assertEq(token.balanceOf(address(expiredVault)), 0);
    }

    function testTransferFailureRollsBackReplayAndAccounting() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        token.setTransferFailure(address(vault), true);

        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(6)), 1);

        vm.expectRevert("MOCK_TRANSFER_FAILED");
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);

        assertEq(vault.totalSpent(), 0);
        assertEq(vault.paymentCount(), 0);
        assertFalse(vault.usedIntentHashes(intentHash));
        assertFalse(vault.usedIntentIds(intent.intentId));
        assertFalse(vault.usedAgentNonces(intent.nonce));
        assertFalse(vault.usedAuthorizationIds(bytes32(uint256(6))));
        assertFalse(vault.usedAuthorizationNonces(1));
    }

    function testReentrancyCannotExecutePaymentTwice() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(6)), 1);
        bytes memory callback = abi.encodeCall(
            CovenantVault.executePayment,
            (intent, intentSignature, authorization, authorizationSignature)
        );
        token.setCallback(address(vault), address(vault), callback);

        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);
        assertTrue(token.callbackAttempted());
        assertFalse(token.callbackSucceeded());
        assertEq(vault.paymentCount(), 1);
        assertEq(vault.totalSpent(), intent.amount);
    }

    function testCrossContractReplayFails() public {
        CovenantVault otherVault = _deployVault(_configuration());
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(2)), 1, 1_250_000);
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(6)), 1);

        vm.expectRevert();
        otherVault.executePayment(intent, intentSignature, authorization, authorizationSignature);
    }

    function testFuzzAuthorizedAmountNeverExceedsLimits(uint64 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, vault.maxAmountPerPayment());
        _execute(_intent(bytes32(uint256(2)), 1, amount), bytes32(uint256(6)), 1);
        assertEq(vault.totalSpent(), amount);
        assertLe(vault.totalSpent(), vault.totalBudget());
    }

    function testFuzzAmountsAbovePerPaymentLimitFail(uint128 excess) public {
        uint256 amount = vault.maxAmountPerPayment() + bound(uint256(excess), 1, type(uint64).max);
        _expectInvalidIntent(_intent(bytes32(uint256(2)), 1, amount));
        assertEq(vault.totalSpent(), 0);
        assertEq(vault.paymentCount(), 0);
    }

    function _expectInvalidIntent(CovenantTypes.PaymentIntent memory intent) private {
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(6)), 1, intentHash);
        bytes memory intentSignature = _signature(AGENT_PRIVATE_KEY, intentHash);
        bytes memory authorizationSignature =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));
        vm.expectRevert(CovenantVault.InvalidPaymentIntent.selector);
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);
    }

    function _expectInvalidAuthorization(
        CovenantTypes.PaymentIntent memory intent,
        bytes memory intentSignature,
        CovenantTypes.AuthorizationReceipt memory authorization
    ) private {
        bytes memory authorizationSignature =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));
        vm.expectRevert(CovenantVault.InvalidAuthorizationReceipt.selector);
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);
    }
}
