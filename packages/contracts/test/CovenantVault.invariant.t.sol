// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CovenantVaultHandler is Test {
    CovenantVault public immutable vault;
    MockUSDC public immutable token;
    address public immutable issuer;
    address public immutable recipient;
    uint256 private immutable agentKey;
    uint256 private immutable authorizationKey;
    uint256 public nextIdentity = 100;
    uint256 public successfulPayments;
    uint256 public failedPayments;
    uint256 public failedTokenPayments;
    uint256 public successfulFunding;
    uint256 public successfulRevocations;
    uint256 public successfulWithdrawals;
    uint256 public successfulSpent;
    bool public badRecipientDelta;
    bool public replaySucceeded;
    bool public failedTokenChangedState;
    bool public authorityChanged;
    bool public withdrawalChangedSpent;
    bool public withdrawalClearedReplay;
    bool public paymentSucceededAfterRevocationOrExpiry;

    bytes32[] public consumedIntentHashes;
    bytes32[] public consumedIntentIds;
    uint256[] public consumedAgentNonces;
    bytes32[] public consumedAuthorizationIds;
    uint256[] public consumedAuthorizationNonces;
    bytes32[] public failedIntentHashes;
    bytes32[] public failedIntentIds;
    uint256[] public failedAgentNonces;
    bytes32[] public failedAuthorizationIds;
    uint256[] public failedAuthorizationNonces;

    constructor(
        CovenantVault vault_,
        MockUSDC token_,
        address issuer_,
        address recipient_,
        uint256 agentKey_,
        uint256 authorizationKey_
    ) {
        vault = vault_;
        token = token_;
        issuer = issuer_;
        recipient = recipient_;
        agentKey = agentKey_;
        authorizationKey = authorizationKey_;
    }

    function pay(uint96 rawAmount) external {
        uint256 id = nextIdentity++;
        uint256 amount = bound(uint256(rawAmount), 1, vault.maxAmountPerPayment());
        (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory intentSig,
            bytes memory authSig,
            bytes32 digest
        ) = _payment(id, amount);
        uint256 recipientBefore = token.balanceOf(recipient);
        try vault.executePayment(intent, intentSig, auth, authSig) {
            if (vault.revoked() || block.timestamp >= vault.validUntil()) {
                paymentSucceededAfterRevocationOrExpiry = true;
            }
            if (token.balanceOf(recipient) - recipientBefore != amount) badRecipientDelta = true;
            successfulPayments++;
            successfulSpent += amount;
            consumedIntentHashes.push(digest);
            consumedIntentIds.push(intent.intentId);
            consumedAgentNonces.push(intent.nonce);
            consumedAuthorizationIds.push(auth.authorizationId);
            consumedAuthorizationNonces.push(auth.authorizationNonce);
            try vault.executePayment(intent, intentSig, auth, authSig) {
                replaySucceeded = true;
            } catch {}
        } catch {
            failedPayments++;
        }
    }

    function failPayment() external {
        uint256 id = nextIdentity++;
        (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory intentSig,
            bytes memory authSig,
        ) = _payment(id, vault.maxAmountPerPayment() + 1);
        try vault.executePayment(intent, intentSig, auth, authSig) {
            revert("invalid payment succeeded");
        } catch {
            failedPayments++;
        }
    }

    function failTokenPayment() external {
        if (
            vault.revoked() || block.timestamp >= vault.validUntil()
                || vault.paymentCount() >= vault.maxPaymentCount()
        ) return;
        uint256 id = nextIdentity++;
        (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory intentSig,
            bytes memory authSig,
            bytes32 digest
        ) = _payment(id, 1);
        uint256 spent = vault.totalSpent();
        uint256 count = vault.paymentCount();
        token.setTransferFailure(address(vault), true);
        try vault.executePayment(intent, intentSig, auth, authSig) {
            failedTokenChangedState = true;
        } catch {
            failedTokenPayments++;
            failedIntentHashes.push(digest);
            failedIntentIds.push(intent.intentId);
            failedAgentNonces.push(intent.nonce);
            failedAuthorizationIds.push(auth.authorizationId);
            failedAuthorizationNonces.push(auth.authorizationNonce);
            if (
                vault.totalSpent() != spent || vault.paymentCount() != count
                    || vault.usedIntentHashes(digest) || vault.usedIntentIds(intent.intentId)
                    || vault.usedAgentNonces(intent.nonce)
                    || vault.usedAuthorizationIds(auth.authorizationId)
                    || vault.usedAuthorizationNonces(auth.authorizationNonce)
            ) failedTokenChangedState = true;
        }
        token.setTransferFailure(address(vault), false);
    }

    function fund(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000);
        uint256 budget = vault.totalBudget();
        vm.prank(issuer);
        try vault.fund(amount) {
            successfulFunding++;
        } catch {}
        if (vault.totalBudget() != budget) authorityChanged = true;
    }

    function directTransfer(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000);
        uint256 budget = vault.totalBudget();
        uint256 maximum = vault.maxAmountPerPayment();
        uint256 limit = vault.maxPaymentCount();
        uint256 spent = vault.totalSpent();
        uint256 count = vault.paymentCount();
        vm.prank(issuer);
        token.transfer(address(vault), amount);
        if (
            vault.totalBudget() != budget || vault.maxAmountPerPayment() != maximum
                || vault.maxPaymentCount() != limit || vault.totalSpent() != spent
                || vault.paymentCount() != count
        ) authorityChanged = true;
    }

    function revoke() external {
        vm.prank(issuer);
        try vault.revoke() {
            successfulRevocations++;
        } catch {}
    }

    function withdraw() external {
        uint256 spent = vault.totalSpent();
        uint256 issuerBefore = token.balanceOf(issuer);
        uint256 vaultBefore = token.balanceOf(address(vault));
        vm.prank(issuer);
        try vault.withdrawRemaining() {
            successfulWithdrawals++;
            if (token.balanceOf(issuer) - issuerBefore != vaultBefore) badRecipientDelta = true;
            for (uint256 i; i < consumedIntentHashes.length; ++i) {
                if (!vault.usedIntentHashes(consumedIntentHashes[i])) {
                    withdrawalClearedReplay = true;
                }
            }
        } catch {}
        if (vault.totalSpent() != spent) withdrawalChangedSpent = true;
    }

    function expire() external {
        vm.warp(vault.validUntil());
    }

    function consumedLength() external view returns (uint256) {
        return consumedIntentHashes.length;
    }

    function failedLength() external view returns (uint256) {
        return failedIntentHashes.length;
    }

    function _payment(uint256 id, uint256 amount)
        private
        view
        returns (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory intentSig,
            bytes memory authSig,
            bytes32 digest
        )
    {
        intent = CovenantTypes.PaymentIntent(
            "1",
            bytes32(id),
            vault.covenantId(),
            vault.agentSigner(),
            vault.recipient(),
            address(vault.token()),
            amount,
            bytes32(uint256(8)),
            "Purchase approved GPU compute",
            vault.validAfter(),
            vault.validUntil(),
            id
        );
        digest = vault.hashPaymentIntent(intent);
        auth = CovenantTypes.AuthorizationReceipt(
            "1",
            bytes32(id + 1_000_000),
            bytes32(id + 2_000_000),
            vault.covenantId(),
            digest,
            address(vault),
            block.chainid,
            "gpu-policy-1",
            id + 1_000_000,
            vault.validUntil(),
            vault.authorizationSigner()
        );
        intentSig = _sign(agentKey, digest);
        authSig = _sign(authorizationKey, vault.hashAuthorizationReceipt(auth));
    }

    function _sign(uint256 key, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}

contract CovenantVaultInvariantTest is StdInvariant, CovenantVaultTestBase {
    CovenantVaultHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CovenantVaultHandler(
            vault, token, issuer, recipient, AGENT_PRIVATE_KEY, AUTHORIZATION_PRIVATE_KEY
        );
        handler.pay(1);
        handler.failPayment();
        handler.failTokenPayment();
        handler.fund(1);
        handler.directTransfer(1);
        handler.revoke();
        handler.withdraw();
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.pay.selector;
        selectors[1] = handler.failPayment.selector;
        selectors[2] = handler.failTokenPayment.selector;
        selectors[3] = handler.fund.selector;
        selectors[4] = handler.directTransfer.selector;
        selectors[5] = handler.revoke.selector;
        selectors[6] = handler.withdraw.selector;
        selectors[7] = handler.expire.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariantAccountingBoundsAndExactOutflows() public view {
        assertLe(vault.totalSpent(), vault.totalBudget());
        assertLe(vault.paymentCount(), vault.maxPaymentCount());
        assertEq(vault.totalSpent(), handler.successfulSpent());
        assertEq(vault.paymentCount(), handler.successfulPayments());
        assertFalse(handler.badRecipientDelta());
        assertFalse(handler.paymentSucceededAfterRevocationOrExpiry());
    }

    function invariantReplayStateIsPermanentAndFailedSettlementIsClean() public view {
        assertFalse(handler.replaySucceeded());
        assertFalse(handler.failedTokenChangedState());
        assertFalse(handler.withdrawalClearedReplay());
        for (uint256 i; i < handler.consumedLength(); ++i) {
            assertTrue(vault.usedIntentHashes(handler.consumedIntentHashes(i)));
            assertTrue(vault.usedIntentIds(handler.consumedIntentIds(i)));
            assertTrue(vault.usedAgentNonces(handler.consumedAgentNonces(i)));
            assertTrue(vault.usedAuthorizationIds(handler.consumedAuthorizationIds(i)));
            assertTrue(vault.usedAuthorizationNonces(handler.consumedAuthorizationNonces(i)));
        }
        for (uint256 i; i < handler.failedLength(); ++i) {
            assertFalse(vault.usedIntentHashes(handler.failedIntentHashes(i)));
            assertFalse(vault.usedIntentIds(handler.failedIntentIds(i)));
            assertFalse(vault.usedAgentNonces(handler.failedAgentNonces(i)));
            assertFalse(vault.usedAuthorizationIds(handler.failedAuthorizationIds(i)));
            assertFalse(vault.usedAuthorizationNonces(handler.failedAuthorizationNonces(i)));
        }
    }

    function invariantAuthorityAndRevocationAreMonotonic() public view {
        assertTrue(vault.revoked());
        assertFalse(handler.authorityChanged());
        assertFalse(handler.withdrawalChangedSpent());
        assertEq(vault.totalBudget(), 10_000_000_000);
    }

    function afterInvariant() public view {
        assertGt(handler.successfulPayments(), 0);
        assertGt(handler.failedPayments(), 0);
        assertGt(handler.failedTokenPayments(), 0);
        assertGt(handler.successfulFunding(), 0);
        assertGt(handler.successfulRevocations(), 0);
        assertGt(handler.successfulWithdrawals(), 0);
    }
}
