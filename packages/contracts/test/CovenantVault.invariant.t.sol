// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

abstract contract GeneratedHandlerBase is Test {
    CovenantVault public immutable vault;
    MockUSDC public immutable token;
    address public immutable issuer;
    uint256 internal immutable agentKey;
    uint256 internal immutable authorizationKey;
    uint256 internal nextIdentity = 100;

    constructor(
        CovenantVault vault_,
        MockUSDC token_,
        address issuer_,
        uint256 agentKey_,
        uint256 authorizationKey_
    ) {
        vault = vault_;
        token = token_;
        issuer = issuer_;
        agentKey = agentKey_;
        authorizationKey = authorizationKey_;
    }

    function _payment(uint256 amount)
        internal
        returns (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory intentSignature,
            bytes memory authorizationSignature,
            bytes32 intentHash
        )
    {
        uint256 identity = nextIdentity++;
        intent = CovenantTypes.PaymentIntent(
            "1",
            bytes32(identity),
            vault.covenantId(),
            vault.agentSigner(),
            vault.recipient(),
            address(vault.token()),
            amount,
            bytes32(uint256(8)),
            "Purchase approved GPU compute",
            vault.validAfter(),
            vault.validUntil(),
            identity
        );
        intentHash = vault.hashPaymentIntent(intent);
        authorization = CovenantTypes.AuthorizationReceipt(
            "1",
            bytes32(identity + 1_000_000),
            bytes32(identity + 2_000_000),
            vault.covenantId(),
            intentHash,
            address(vault),
            block.chainid,
            "gpu-policy-1",
            identity + 1_000_000,
            vault.validUntil(),
            vault.authorizationSigner()
        );
        intentSignature = _sign(agentKey, intentHash);
        authorizationSignature =
            _sign(authorizationKey, vault.hashAuthorizationReceipt(authorization));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _selector(bytes memory reason) internal pure returns (bytes4 value) {
        if (reason.length < 4) return bytes4(0);
        assembly ("memory-safe") { value := mload(add(reason, 0x20)) }
    }
}

contract ActivePaymentHandler is GeneratedHandlerBase {
    error SuccessfulPaymentUnreached();
    error SuccessfulDirectTransferUnreached();

    bool public immutable forceAllPaymentsToFail;
    uint256 public generatedSuccessfulPayments;
    uint256 public generatedFailedPayments;
    uint256 public generatedFailedTokenSettlements;
    uint256 public generatedSuccessfulFunding;
    uint256 public generatedReplayFailures;
    uint256 public generatedDirectTransfers;
    uint256 public generatedSpent;
    bool public failedTokenChangedState;
    bool public authorityChanged;
    bool public recipientDeltaMismatch;
    bool public replayUnexpectedlySucceeded;
    uint256 public generatedPhase;

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
        uint256 agentKey_,
        uint256 authorizationKey_,
        bool forceFailure_
    ) GeneratedHandlerBase(vault_, token_, issuer_, agentKey_, authorizationKey_) {
        forceAllPaymentsToFail = forceFailure_;
    }

    function advanceCampaign() external {
        uint256 current = generatedPhase;
        if (current >= 6) return;
        generatedPhase = current + 1;
        if (current == 0) pay();
        else if (current == 1) failPayment();
        else if (current == 2) failTokenSettlement();
        else if (current == 3) fund();
        else if (current == 4) replay();
        else directTransfer();
    }

    function pay() public {
        uint256 amount = forceAllPaymentsToFail ? vault.maxAmountPerPayment() + 1 : 1;
        (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory intentSignature,
            bytes memory authorizationSignature,
            bytes32 intentHash
        ) = _payment(amount);
        uint256 recipientBefore = token.balanceOf(vault.recipient());
        try vault.executePayment(intent, intentSignature, authorization, authorizationSignature) {
            if (forceAllPaymentsToFail) revert("mutant payment succeeded");
            generatedSuccessfulPayments++;
            generatedSpent += amount;
            if (token.balanceOf(vault.recipient()) - recipientBefore != amount) {
                recipientDeltaMismatch = true;
            }
            consumedIntentHashes.push(intentHash);
            consumedIntentIds.push(intent.intentId);
            consumedAgentNonces.push(intent.nonce);
            consumedAuthorizationIds.push(authorization.authorizationId);
            consumedAuthorizationNonces.push(authorization.authorizationNonce);
        } catch (bytes memory reason) {
            if (
                forceAllPaymentsToFail
                    && _selector(reason) == CovenantVault.InvalidPaymentIntent.selector
            ) {
                generatedFailedPayments++;
            }
        }
    }

    function failPayment() public {
        (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory intentSignature,
            bytes memory authorizationSignature,
        ) = _payment(vault.maxAmountPerPayment() + 1);
        try vault.executePayment(intent, intentSignature, authorization, authorizationSignature) {
            revert("invalid payment succeeded");
        } catch (bytes memory reason) {
            if (_selector(reason) == CovenantVault.InvalidPaymentIntent.selector) {
                generatedFailedPayments++;
            }
        }
    }

    function failTokenSettlement() public {
        (
            CovenantTypes.PaymentIntent memory intent,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory intentSignature,
            bytes memory authorizationSignature,
            bytes32 intentHash
        ) = _payment(1);
        uint256 spentBefore = vault.totalSpent();
        uint256 countBefore = vault.paymentCount();
        token.setTransferFailure(address(vault), true);
        try vault.executePayment(intent, intentSignature, authorization, authorizationSignature) {
            failedTokenChangedState = true;
        } catch Error(string memory reason) {
            if (keccak256(bytes(reason)) == keccak256("MOCK_TRANSFER_FAILED")) {
                generatedFailedTokenSettlements++;
                failedIntentHashes.push(intentHash);
                failedIntentIds.push(intent.intentId);
                failedAgentNonces.push(intent.nonce);
                failedAuthorizationIds.push(authorization.authorizationId);
                failedAuthorizationNonces.push(authorization.authorizationNonce);
                if (
                    vault.totalSpent() != spentBefore || vault.paymentCount() != countBefore
                        || vault.usedIntentHashes(intentHash)
                        || vault.usedIntentIds(intent.intentId)
                        || vault.usedAgentNonces(intent.nonce)
                        || vault.usedAuthorizationIds(authorization.authorizationId)
                        || vault.usedAuthorizationNonces(authorization.authorizationNonce)
                ) failedTokenChangedState = true;
            }
        } catch {
            failedTokenChangedState = true;
        }
        token.setTransferFailure(address(vault), false);
    }

    function replay() public {
        uint256 length = consumedIntentHashes.length;
        if (length == 0) return;
        uint256 index = length - 1;
        CovenantTypes.PaymentIntent memory intent = CovenantTypes.PaymentIntent(
            "1",
            consumedIntentIds[index],
            vault.covenantId(),
            vault.agentSigner(),
            vault.recipient(),
            address(vault.token()),
            1,
            bytes32(uint256(8)),
            "Purchase approved GPU compute",
            vault.validAfter(),
            vault.validUntil(),
            consumedAgentNonces[index]
        );
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory authorization = CovenantTypes.AuthorizationReceipt(
            "1",
            consumedAuthorizationIds[index],
            bytes32(uint256(consumedAuthorizationNonces[index] + 1_000_000)),
            vault.covenantId(),
            intentHash,
            address(vault),
            block.chainid,
            "gpu-policy-1",
            consumedAuthorizationNonces[index],
            vault.validUntil(),
            vault.authorizationSigner()
        );
        try vault.executePayment(
            intent,
            _sign(agentKey, intentHash),
            authorization,
            _sign(authorizationKey, vault.hashAuthorizationReceipt(authorization))
        ) {
            replayUnexpectedlySucceeded = true;
        } catch (bytes memory reason) {
            if (_selector(reason) == CovenantVault.ReplayDetected.selector) {
                generatedReplayFailures++;
            }
        }
    }

    function fund() public {
        uint256 budget = vault.totalBudget();
        vm.prank(issuer);
        try vault.fund(1) {
            generatedSuccessfulFunding++;
        } catch {}
        if (vault.totalBudget() != budget) authorityChanged = true;
    }

    function directTransfer() public {
        uint256 budget = vault.totalBudget();
        uint256 maximum = vault.maxAmountPerPayment();
        uint256 countLimit = vault.maxPaymentCount();
        uint256 spent = vault.totalSpent();
        uint256 count = vault.paymentCount();
        uint256 vaultBalance = token.balanceOf(address(vault));
        vm.prank(issuer);
        try token.transfer(address(vault), 1) returns (bool transferred) {
            if (transferred && token.balanceOf(address(vault)) == vaultBalance + 1) {
                generatedDirectTransfers++;
            }
        } catch {}
        if (
            vault.totalBudget() != budget || vault.maxAmountPerPayment() != maximum
                || vault.maxPaymentCount() != countLimit || vault.totalSpent() != spent
                || vault.paymentCount() != count
        ) authorityChanged = true;
    }

    function assertSuccessfulPaymentReachability() external view {
        if (generatedSuccessfulPayments == 0) revert SuccessfulPaymentUnreached();
    }

    function assertSuccessfulDirectTransferReachability() external view {
        if (generatedDirectTransfers == 0) revert SuccessfulDirectTransferUnreached();
    }

    function consumedLength() external view returns (uint256) {
        return consumedIntentHashes.length;
    }

    function failedLength() external view returns (uint256) {
        return failedIntentHashes.length;
    }
}

contract RevocationHandler is GeneratedHandlerBase {
    uint256 public phase;
    uint256 public generatedSuccessfulPayments;
    uint256 public generatedSuccessfulRevocations;
    uint256 public generatedPostRevocationPaymentFailures;
    uint256 public generatedRepeatedRevocationFailures;
    bool public unexpectedOutcome;
    bytes32 public consumedIntentHash;
    bytes32 public consumedIntentId;
    uint256 public consumedAgentNonce;
    bytes32 public consumedAuthorizationId;
    uint256 public consumedAuthorizationNonce;

    constructor(
        CovenantVault vault_,
        MockUSDC token_,
        address issuer_,
        uint256 agentKey_,
        uint256 authorizationKey_
    ) GeneratedHandlerBase(vault_, token_, issuer_, agentKey_, authorizationKey_) {}

    function advanceLifecycle() external {
        if (phase == 0) {
            (
                CovenantTypes.PaymentIntent memory intent,
                CovenantTypes.AuthorizationReceipt memory authorization,
                bytes memory intentSignature,
                bytes memory authorizationSignature,
                bytes32 intentHash
            ) = _payment(1);
            try vault.executePayment(
                intent, intentSignature, authorization, authorizationSignature
            ) {
                generatedSuccessfulPayments++;
                consumedIntentHash = intentHash;
                consumedIntentId = intent.intentId;
                consumedAgentNonce = intent.nonce;
                consumedAuthorizationId = authorization.authorizationId;
                consumedAuthorizationNonce = authorization.authorizationNonce;
                phase = 1;
            } catch {
                unexpectedOutcome = true;
            }
        } else if (phase == 1) {
            vm.prank(issuer);
            try vault.revoke() {
                generatedSuccessfulRevocations++;
                phase = 2;
            } catch {
                unexpectedOutcome = true;
            }
        } else if (phase == 2) {
            (
                CovenantTypes.PaymentIntent memory intent,
                CovenantTypes.AuthorizationReceipt memory authorization,
                bytes memory intentSignature,
                bytes memory authorizationSignature,
            ) = _payment(1);
            try vault.executePayment(
                intent, intentSignature, authorization, authorizationSignature
            ) {
                unexpectedOutcome = true;
            } catch (bytes memory reason) {
                if (_selector(reason) == CovenantVault.CovenantIsRevoked.selector) {
                    generatedPostRevocationPaymentFailures++;
                    phase = 3;
                } else {
                    unexpectedOutcome = true;
                }
            }
        } else if (phase == 3) {
            vm.prank(issuer);
            try vault.revoke() {
                unexpectedOutcome = true;
            } catch (bytes memory reason) {
                if (_selector(reason) == CovenantVault.CovenantAlreadyRevoked.selector) {
                    generatedRepeatedRevocationFailures++;
                    phase = 4;
                } else {
                    unexpectedOutcome = true;
                }
            }
        }
    }
}

contract WithdrawalHandler is GeneratedHandlerBase {
    address public immutable attacker;
    uint256 public phase;
    uint256 public generatedInvalidWithdrawalFailures;
    uint256 public generatedSuccessfulFunding;
    uint256 public generatedSuccessfulRevocations;
    uint256 public generatedSuccessfulWithdrawals;
    bool public unexpectedOutcome;
    bool public withdrawalStateMismatch;

    constructor(
        CovenantVault vault_,
        MockUSDC token_,
        address issuer_,
        address attacker_,
        uint256 agentKey_,
        uint256 authorizationKey_
    ) GeneratedHandlerBase(vault_, token_, issuer_, agentKey_, authorizationKey_) {
        attacker = attacker_;
    }

    function advanceLifecycle() external {
        if (phase == 0) {
            vm.prank(issuer);
            try vault.withdrawRemaining() {
                unexpectedOutcome = true;
            } catch (bytes memory reason) {
                if (_selector(reason) == CovenantVault.WithdrawalUnavailable.selector) {
                    generatedInvalidWithdrawalFailures++;
                    phase = 1;
                } else {
                    unexpectedOutcome = true;
                }
            }
        } else if (phase == 1) {
            vm.prank(issuer);
            try vault.fund(10) {
                generatedSuccessfulFunding++;
                phase = 2;
            } catch {
                unexpectedOutcome = true;
            }
        } else if (phase == 2) {
            vm.prank(issuer);
            try vault.revoke() {
                generatedSuccessfulRevocations++;
                phase = 3;
            } catch {
                unexpectedOutcome = true;
            }
        } else if (phase == 3) {
            uint256 vaultBefore = token.balanceOf(address(vault));
            uint256 issuerBefore = token.balanceOf(issuer);
            uint256 spentBefore = vault.totalSpent();
            uint256 countBefore = vault.paymentCount();
            vm.prank(issuer);
            try vault.withdrawRemaining() {
                generatedSuccessfulWithdrawals++;
                phase = 4;
                if (
                    token.balanceOf(address(vault)) != 0
                        || token.balanceOf(issuer) - issuerBefore != vaultBefore
                        || vault.totalSpent() != spentBefore || vault.paymentCount() != countBefore
                ) withdrawalStateMismatch = true;
            } catch {
                unexpectedOutcome = true;
            }
        } else if (phase == 4) {
            vm.prank(attacker);
            try vault.withdrawRemaining() {
                unexpectedOutcome = true;
            } catch (bytes memory reason) {
                if (_selector(reason) == CovenantVault.UnauthorizedCaller.selector) {
                    generatedInvalidWithdrawalFailures++;
                    phase = 5;
                } else {
                    unexpectedOutcome = true;
                }
            }
        }
    }
}

abstract contract CampaignBase is StdInvariant, CovenantVaultTestBase {
    function _campaignVault() internal returns (CovenantVault campaignVault) {
        CovenantTypes.Configuration memory configuration = _configuration();
        configuration.maxAmountPerPayment = 1_000_000;
        configuration.maxPaymentCount = 1_000_000;
        campaignVault = _deployVault(configuration);
        token.mint(address(campaignVault), 1_000_000_000);
        token.mint(issuer, 1_000_000_000);
        vm.prank(issuer);
        token.approve(address(campaignVault), type(uint256).max);
    }
}

contract ActivePaymentInvariantTest is CampaignBase {
    ActivePaymentHandler internal handler;

    function setUp() public override {
        super.setUp();
        vault = _campaignVault();
        handler = new ActivePaymentHandler(
            vault, token, issuer, AGENT_PRIVATE_KEY, AUTHORIZATION_PRIVATE_KEY, false
        );
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = handler.advanceCampaign.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariantGeneratedPaymentStateIsSound() public view {
        assertEq(vault.totalSpent(), handler.generatedSpent());
        assertEq(vault.paymentCount(), handler.generatedSuccessfulPayments());
        assertFalse(handler.failedTokenChangedState());
        assertFalse(handler.authorityChanged());
        assertFalse(handler.recipientDeltaMismatch());
        assertFalse(handler.replayUnexpectedlySucceeded());
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

    function afterInvariant() public {
        assertGt(handler.generatedSuccessfulPayments(), 0);
        assertGt(handler.generatedFailedPayments(), 0);
        assertGt(handler.generatedFailedTokenSettlements(), 0);
        assertGt(handler.generatedSuccessfulFunding(), 0);
        assertGt(handler.generatedReplayFailures(), 0);
        assertGt(handler.generatedDirectTransfers(), 0);
        emit log_named_uint("generatedSuccessfulPayments", handler.generatedSuccessfulPayments());
        emit log_named_uint("generatedFailedPayments", handler.generatedFailedPayments());
        emit log_named_uint(
            "generatedFailedTokenSettlements", handler.generatedFailedTokenSettlements()
        );
        emit log_named_uint("generatedSuccessfulFunding", handler.generatedSuccessfulFunding());
    }
}

contract RevocationInvariantTest is CampaignBase {
    RevocationHandler internal handler;

    function setUp() public override {
        super.setUp();
        vault = _campaignVault();
        handler = new RevocationHandler(
            vault, token, issuer, AGENT_PRIVATE_KEY, AUTHORIZATION_PRIVATE_KEY
        );
        targetContract(address(handler));
    }

    function invariantRevocationIsMonotonic() public view {
        assertFalse(handler.unexpectedOutcome());
        if (handler.phase() >= 1) {
            assertTrue(vault.usedIntentHashes(handler.consumedIntentHash()));
            assertTrue(vault.usedIntentIds(handler.consumedIntentId()));
            assertTrue(vault.usedAgentNonces(handler.consumedAgentNonce()));
            assertTrue(vault.usedAuthorizationIds(handler.consumedAuthorizationId()));
            assertTrue(vault.usedAuthorizationNonces(handler.consumedAuthorizationNonce()));
        }
        if (handler.phase() >= 2) assertTrue(vault.revoked());
    }

    function afterInvariant() public {
        assertGt(handler.generatedSuccessfulPayments(), 0);
        assertGt(handler.generatedSuccessfulRevocations(), 0);
        assertGt(handler.generatedPostRevocationPaymentFailures(), 0);
        assertGt(handler.generatedRepeatedRevocationFailures(), 0);
        emit log_named_uint(
            "generatedSuccessfulRevocations", handler.generatedSuccessfulRevocations()
        );
        emit log_named_uint(
            "generatedPostRevocationPaymentFailures",
            handler.generatedPostRevocationPaymentFailures()
        );
    }
}

contract WithdrawalInvariantTest is CampaignBase {
    WithdrawalHandler internal handler;

    function setUp() public override {
        super.setUp();
        vault = _campaignVault();
        handler = new WithdrawalHandler(
            vault, token, issuer, attacker, AGENT_PRIVATE_KEY, AUTHORIZATION_PRIVATE_KEY
        );
        targetContract(address(handler));
    }

    function invariantWithdrawalLifecycleIsSound() public view {
        assertFalse(handler.unexpectedOutcome());
        assertFalse(handler.withdrawalStateMismatch());
    }

    function afterInvariant() public {
        assertGt(handler.generatedSuccessfulFunding(), 0);
        assertGt(handler.generatedSuccessfulRevocations(), 0);
        assertGt(handler.generatedSuccessfulWithdrawals(), 0);
        assertGt(handler.generatedInvalidWithdrawalFailures(), 1);
        emit log_named_uint(
            "generatedSuccessfulWithdrawals", handler.generatedSuccessfulWithdrawals()
        );
    }
}

contract InvariantReachabilityMutantTest is CampaignBase {
    function testAllPaymentsForcedToFailBreakSuccessfulPaymentReachability() public {
        CovenantVault campaignVault = _campaignVault();
        ActivePaymentHandler mutant = new ActivePaymentHandler(
            campaignVault, token, issuer, AGENT_PRIVATE_KEY, AUTHORIZATION_PRIVATE_KEY, true
        );
        mutant.pay();
        assertEq(mutant.generatedSuccessfulPayments(), 0);
        assertEq(mutant.generatedFailedPayments(), 1);
        vm.expectRevert(ActivePaymentHandler.SuccessfulPaymentUnreached.selector);
        mutant.assertSuccessfulPaymentReachability();
    }

    function testTransferSuccessWithoutBalanceIncreaseBreaksDirectTransferReachability() public {
        CovenantVault campaignVault = _campaignVault();
        ActivePaymentHandler mutant = new ActivePaymentHandler(
            campaignVault, token, issuer, AGENT_PRIVATE_KEY, AUTHORIZATION_PRIVATE_KEY, false
        );
        token.setTransferSuccessWithoutMovement(true);
        mutant.directTransfer();
        assertEq(mutant.generatedDirectTransfers(), 0);
        vm.expectRevert(ActivePaymentHandler.SuccessfulDirectTransferUnreached.selector);
        mutant.assertSuccessfulDirectTransferReachability();
    }
}
