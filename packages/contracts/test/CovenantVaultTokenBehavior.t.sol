// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";
import {
    TestTokenBase,
    FalseReturnToken,
    NoReturnToken,
    RevertingToken,
    FeeOnTransferToken,
    SuccessWithoutTransferToken
} from "./mocks/HostileTokens.sol";

contract CovenantVaultTokenBehaviorTest is CovenantVaultTestBase {
    function testFuzzDeliveredBalanceMismatchRollsBack(uint96 rawAmount) public {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000);
        FeeOnTransferToken other = new FeeOnTransferToken();
        CovenantVault otherVault = _vaultFor(address(other));
        other.mint(address(otherVault), amount);
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(71)), 71, amount);
        intent.token = address(other);
        bytes32 digest = otherVault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory auth =
            _authorization(bytes32(uint256(72)), 72, digest);
        auth.vaultAddress = address(otherVault);
        bytes memory intentSig = _signature(AGENT_PRIVATE_KEY, digest);
        bytes memory authSig =
            _signature(AUTHORIZATION_PRIVATE_KEY, otherVault.hashAuthorizationReceipt(auth));
        vm.expectPartialRevert(CovenantVault.TokenBalanceDeltaMismatch.selector);
        otherVault.executePayment(intent, intentSig, auth, authSig);
        assertEq(otherVault.totalSpent(), 0);
        assertEq(otherVault.paymentCount(), 0);
        assertFalse(otherVault.usedIntentHashes(digest));
    }

    function testNoReturnTokenSupportsFundingPaymentAndWithdrawalWithExactDeltas() public {
        NoReturnToken other = new NoReturnToken();
        CovenantVault otherVault = _vaultFor(address(other));
        other.mint(issuer, 3_000_000);
        vm.startPrank(issuer);
        other.approve(address(otherVault), type(uint256).max);
        vm.expectEmit(true, false, false, true, address(otherVault));
        emit CovenantVault.CovenantFunded(issuer, 3_000_000);
        otherVault.fund(3_000_000);
        vm.stopPrank();

        _executeOn(otherVault, address(other), bytes32(uint256(81)), 81, 1_000_000);
        assertEq(other.balanceOf(recipient), 1_000_000);
        vm.prank(issuer);
        otherVault.revoke();
        uint256 beforeBalance = other.balanceOf(issuer);
        vm.prank(issuer);
        otherVault.withdrawRemaining();
        assertEq(other.balanceOf(issuer) - beforeBalance, 2_000_000);
    }

    function testFundingRejectsFalseRevertingFeeAndSuccessWithoutTransferTokens() public {
        _expectFundingFailure(address(new FalseReturnToken()), false);
        _expectFundingFailure(address(new RevertingToken()), false);
        _expectFundingFailure(address(new FeeOnTransferToken()), true);
        _expectFundingFailure(address(new SuccessWithoutTransferToken()), true);
    }

    function testExecutionFailuresRollBackAccountingAndEveryReplayIdentity() public {
        _expectExecutionSettlementFailure(address(new FalseReturnToken()), false);
        _expectExecutionSettlementFailure(address(new RevertingToken()), false);
        _expectExecutionSettlementFailure(address(new FeeOnTransferToken()), true);
        _expectExecutionSettlementFailure(address(new SuccessWithoutTransferToken()), true);
    }

    function testWithdrawalRejectsFalseRevertingFeeAndSuccessWithoutTransferTokens() public {
        _expectWithdrawalFailure(address(new FalseReturnToken()));
        _expectWithdrawalFailure(address(new RevertingToken()));
        _expectWithdrawalFailure(address(new FeeOnTransferToken()));
        _expectWithdrawalFailure(address(new SuccessWithoutTransferToken()));
    }

    function testDirectTransferNeverChangesAuthorityAndRemainsExecutableWithdrawable() public {
        uint256 budget = vault.totalBudget();
        uint256 maxAmount = vault.maxAmountPerPayment();
        uint256 maxCount = vault.maxPaymentCount();
        token.mint(issuer, 2_000_000);
        vm.prank(issuer);
        token.transfer(address(vault), 2_000_000);
        assertEq(vault.totalBudget(), budget);
        assertEq(vault.maxAmountPerPayment(), maxAmount);
        assertEq(vault.maxPaymentCount(), maxCount);
        assertEq(vault.totalSpent(), 0);
        assertEq(vault.paymentCount(), 0);

        _execute(_intent(bytes32(uint256(91)), 91, 1_000_000), bytes32(uint256(92)), 92);
        uint256 spent = vault.totalSpent();
        uint256 count = vault.paymentCount();
        vm.prank(issuer);
        vault.revoke();
        vm.prank(issuer);
        vault.withdrawRemaining();
        assertEq(vault.totalBudget(), budget);
        assertEq(vault.maxAmountPerPayment(), maxAmount);
        assertEq(vault.maxPaymentCount(), maxCount);
        assertEq(vault.totalSpent(), spent);
        assertEq(vault.paymentCount(), count);
    }

    function testReentrancyAttemptsThroughFundExecuteAndWithdrawAreContained() public {
        token.mint(issuer, 3);
        token.setCallback(issuer, address(vault), abi.encodeCall(CovenantVault.fund, (uint256(1))));
        vm.prank(issuer);
        vault.fund(2);
        assertTrue(token.callbackAttempted());
        assertFalse(token.callbackSucceeded());

        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(95)), 95, 1);
        (
            bytes memory intentSig,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory authSig
        ) = _signedPayment(intent, bytes32(uint256(96)), 96);
        token.setCallback(
            address(vault),
            address(vault),
            abi.encodeCall(CovenantVault.executePayment, (intent, intentSig, auth, authSig))
        );
        vault.executePayment(intent, intentSig, auth, authSig);
        assertFalse(token.callbackSucceeded());
        assertEq(vault.paymentCount(), 1);

        vm.prank(issuer);
        vault.revoke();
        token.setCallback(
            address(vault), address(vault), abi.encodeCall(CovenantVault.withdrawRemaining, ())
        );
        vm.prank(issuer);
        vault.withdrawRemaining();
        assertTrue(token.callbackAttempted());
        assertFalse(token.callbackSucceeded());
        assertEq(token.balanceOf(address(vault)), 0);
    }

    function _vaultFor(address otherToken) private returns (CovenantVault otherVault) {
        CovenantTypes.Configuration memory configuration = _configuration();
        configuration.token = otherToken;
        otherVault = _deployVault(configuration);
    }

    function _expectFundingFailure(address otherToken, bool expectDeltaError) private {
        TestTokenBase other = TestTokenBase(otherToken);
        CovenantVault otherVault = _vaultFor(otherToken);
        other.mint(issuer, 100);
        vm.startPrank(issuer);
        other.approve(address(otherVault), type(uint256).max);
        if (expectDeltaError) {
            vm.expectPartialRevert(CovenantVault.TokenBalanceDeltaMismatch.selector);
        } else {
            vm.expectRevert();
        }
        otherVault.fund(100);
        vm.stopPrank();
        assertEq(other.balanceOf(address(otherVault)), 0);
    }

    function _expectExecutionSettlementFailure(address otherToken, bool expectDeltaError) private {
        TestTokenBase other = TestTokenBase(otherToken);
        CovenantVault otherVault = _vaultFor(otherToken);
        other.mint(address(otherVault), 100);
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(101)), 101, 100);
        intent.token = otherToken;
        bytes32 intentHash = otherVault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory auth =
            _authorization(bytes32(uint256(102)), 102, intentHash);
        auth.vaultAddress = address(otherVault);
        bytes memory intentSig = _signature(AGENT_PRIVATE_KEY, intentHash);
        bytes memory authSig =
            _signature(AUTHORIZATION_PRIVATE_KEY, otherVault.hashAuthorizationReceipt(auth));
        if (expectDeltaError) {
            vm.expectPartialRevert(CovenantVault.TokenBalanceDeltaMismatch.selector);
        } else {
            vm.expectRevert();
        }
        otherVault.executePayment(intent, intentSig, auth, authSig);
        assertEq(otherVault.totalSpent(), 0);
        assertEq(otherVault.paymentCount(), 0);
        assertFalse(otherVault.usedIntentHashes(intentHash));
        assertFalse(otherVault.usedIntentIds(intent.intentId));
        assertFalse(otherVault.usedAgentNonces(intent.nonce));
        assertFalse(otherVault.usedAuthorizationIds(auth.authorizationId));
        assertFalse(otherVault.usedAuthorizationNonces(auth.authorizationNonce));
    }

    function _expectWithdrawalFailure(address otherToken) private {
        TestTokenBase other = TestTokenBase(otherToken);
        CovenantVault otherVault = _vaultFor(otherToken);
        other.mint(address(otherVault), 100);
        vm.prank(issuer);
        otherVault.revoke();
        vm.expectRevert();
        vm.prank(issuer);
        otherVault.withdrawRemaining();
        assertEq(other.balanceOf(address(otherVault)), 100);
        assertEq(other.balanceOf(issuer), 0);
    }

    function _executeOn(
        CovenantVault otherVault,
        address otherToken,
        bytes32 intentId,
        uint256 nonce,
        uint256 amount
    ) private {
        CovenantTypes.PaymentIntent memory intent = _intent(intentId, nonce, amount);
        intent.token = otherToken;
        bytes32 intentHash = otherVault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory auth =
            _authorization(bytes32(uint256(82)), 82, intentHash);
        auth.vaultAddress = address(otherVault);
        otherVault.executePayment(
            intent,
            _signature(AGENT_PRIVATE_KEY, intentHash),
            auth,
            _signature(AUTHORIZATION_PRIVATE_KEY, otherVault.hashAuthorizationReceipt(auth))
        );
    }
}
