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
    uint256 private immutable agentPrivateKey;
    uint256 private immutable authorizationPrivateKey;

    uint256 public nextIdentity = 100;
    uint256 public successfulPayments;
    uint256 public successfulSpent;
    bytes32 public lastIntentHash;
    bytes32 public lastIntentId;
    uint256 public lastAgentNonce;
    bytes32 public lastAuthorizationId;
    uint256 public lastAuthorizationNonce;
    bool public successfulPaymentUsedWrongRecipient;
    bool public fundingChangedBudget;
    bool public withdrawalChangedSpent;
    bool public replaySucceeded;
    bool public paymentSucceededAfterRevocation;
    bool public paymentSucceededAtOrAfterExpiry;

    constructor(
        CovenantVault vault_,
        MockUSDC token_,
        address issuer_,
        address recipient_,
        uint256 agentPrivateKey_,
        uint256 authorizationPrivateKey_
    ) {
        vault = vault_;
        token = token_;
        issuer = issuer_;
        recipient = recipient_;
        agentPrivateKey = agentPrivateKey_;
        authorizationPrivateKey = authorizationPrivateKey_;
    }

    function pay(uint96 rawAmount) external {
        uint256 identity = nextIdentity++;
        uint256 maximum = vault.maxAmountPerPayment();
        uint256 amount = bound(uint256(rawAmount), 1, maximum);
        CovenantTypes.PaymentIntent memory intent = _intent(identity, amount);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(identity, intentHash);
        bytes memory intentSignature = _sign(agentPrivateKey, intentHash);
        bytes memory authorizationSignature =
            _sign(authorizationPrivateKey, vault.hashAuthorizationReceipt(authorization));
        uint256 recipientBefore = token.balanceOf(recipient);

        try vault.executePayment(intent, intentSignature, authorization, authorizationSignature) {
            if (vault.revoked()) paymentSucceededAfterRevocation = true;
            if (block.timestamp >= vault.validUntil()) paymentSucceededAtOrAfterExpiry = true;
            if (token.balanceOf(recipient) - recipientBefore != amount) {
                successfulPaymentUsedWrongRecipient = true;
            }
            successfulPayments += 1;
            successfulSpent += amount;
            lastIntentHash = intentHash;
            lastIntentId = intent.intentId;
            lastAgentNonce = intent.nonce;
            lastAuthorizationId = authorization.authorizationId;
            lastAuthorizationNonce = authorization.authorizationNonce;

            try vault.executePayment(
                intent, intentSignature, authorization, authorizationSignature
            ) {
                replaySucceeded = true;
            } catch {}
        } catch {}
    }

    function fund(uint96 rawAmount) external {
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000);
        uint256 budgetBefore = vault.totalBudget();
        vm.prank(issuer);
        try vault.fund(amount) {} catch {}
        if (vault.totalBudget() != budgetBefore) fundingChangedBudget = true;
    }

    function revoke() external {
        vm.prank(issuer);
        try vault.revoke() {} catch {}
    }

    function withdraw() external {
        uint256 spentBefore = vault.totalSpent();
        vm.prank(issuer);
        try vault.withdrawRemaining() {} catch {}
        if (vault.totalSpent() != spentBefore) withdrawalChangedSpent = true;
    }

    function expire() external {
        vm.warp(vault.validUntil());
    }

    function _intent(uint256 identity, uint256 amount)
        private
        view
        returns (CovenantTypes.PaymentIntent memory)
    {
        return CovenantTypes.PaymentIntent({
            version: "1",
            intentId: bytes32(identity),
            covenantId: vault.covenantId(),
            agentSigner: vault.agentSigner(),
            recipient: vault.recipient(),
            token: address(vault.token()),
            amount: amount,
            invoiceHash: bytes32(uint256(8)),
            purpose: "Purchase approved GPU compute",
            createdAt: vault.validAfter(),
            expiresAt: vault.validUntil(),
            nonce: identity
        });
    }

    function _authorization(uint256 identity, bytes32 intentHash)
        private
        view
        returns (CovenantTypes.AuthorizationReceipt memory)
    {
        return CovenantTypes.AuthorizationReceipt({
            version: "1",
            authorizationId: bytes32(identity + 1_000_000),
            decisionId: bytes32(identity + 2_000_000),
            covenantId: vault.covenantId(),
            intentHash: intentHash,
            vaultAddress: address(vault),
            chainId: block.chainid,
            policyVersion: "gpu-policy-1",
            authorizationNonce: identity + 1_000_000,
            validUntil: vault.validUntil(),
            signer: vault.authorizationSigner()
        });
    }

    function _sign(uint256 privateKey, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
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

        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.pay.selector;
        selectors[1] = handler.fund.selector;
        selectors[2] = handler.revoke.selector;
        selectors[3] = handler.withdraw.selector;
        selectors[4] = handler.expire.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariantSpendNeverExceedsBudget() public view {
        assertLe(vault.totalSpent(), vault.totalBudget());
    }

    function invariantPaymentCountNeverExceedsLimit() public view {
        assertLe(vault.paymentCount(), vault.maxPaymentCount());
    }

    function invariantSuccessfulPaymentsUseConfiguredTransferPath() public view {
        assertFalse(handler.successfulPaymentUsedWrongRecipient());
        assertEq(vault.totalSpent(), handler.successfulSpent());
        assertEq(vault.paymentCount(), handler.successfulPayments());
    }

    function invariantReplayStateIsMonotonicAndConsumedPaymentsStayConsumed() public view {
        assertFalse(handler.replaySucceeded());
        if (handler.successfulPayments() != 0) {
            assertTrue(vault.usedIntentHashes(handler.lastIntentHash()));
            assertTrue(vault.usedIntentIds(handler.lastIntentId()));
            assertTrue(vault.usedAgentNonces(handler.lastAgentNonce()));
            assertTrue(vault.usedAuthorizationIds(handler.lastAuthorizationId()));
            assertTrue(vault.usedAuthorizationNonces(handler.lastAuthorizationNonce()));
        }
    }

    function invariantRevocationAndExpiryBlockPayments() public view {
        assertFalse(handler.paymentSucceededAfterRevocation());
        assertFalse(handler.paymentSucceededAtOrAfterExpiry());
    }

    function invariantFundingAndWithdrawalNeverRewriteAuthorityOrSpend() public view {
        assertFalse(handler.fundingChangedBudget());
        assertFalse(handler.withdrawalChangedSpent());
        assertEq(vault.totalBudget(), 10_000_000_000);
    }
}
