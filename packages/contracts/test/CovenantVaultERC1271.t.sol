// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";

contract MockERC1271Agent is IERC1271 {
    enum Response {
        Verify,
        InvalidMagic,
        Revert
    }

    address private immutable owner;
    Response private response;

    constructor(address owner_) {
        owner = owner_;
    }

    function setResponse(Response response_) external {
        response = response_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (response == Response.Revert) revert("ERC1271_REVERT");
        if (response == Response.InvalidMagic) return 0xffffffff;
        (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecover(hash, signature);
        return error == ECDSA.RecoverError.NoError && recovered == owner
            ? IERC1271.isValidSignature.selector
            : bytes4(0xffffffff);
    }
}

contract CovenantVaultERC1271Test is CovenantVaultTestBase {
    MockERC1271Agent private contractAgent;

    function testEOAAgentSignatureStillExecutes() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(801)), 801, 1);

        _execute(intent, bytes32(uint256(802)), 802);

        assertEq(vault.totalSpent(), 1);
        assertEq(vault.paymentCount(), 1);
    }

    function testERC1271AgentSignatureExecutesWithMagicValue() public {
        _useContractAgent();
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(811)), 811, 1);
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(812)), 812);
        bytes32 intentHash = vault.hashPaymentIntent(intent);

        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);

        assertEq(vault.totalSpent(), 1);
        assertEq(vault.paymentCount(), 1);
        assertTrue(vault.usedIntentHashes(intentHash));
        assertTrue(vault.usedIntentIds(intent.intentId));
        assertTrue(vault.usedAgentNonces(intent.nonce));
    }

    function testERC1271InvalidMagicValueFailsClosedWithoutStateChange() public {
        _useContractAgent();
        contractAgent.setResponse(MockERC1271Agent.Response.InvalidMagic);
        _assertAgentFailureLeavesStateUnchanged(_intent(bytes32(uint256(821)), 821, 1));
    }

    function testERC1271RevertFailsClosedWithoutStateChange() public {
        _useContractAgent();
        contractAgent.setResponse(MockERC1271Agent.Response.Revert);
        _assertAgentFailureLeavesStateUnchanged(_intent(bytes32(uint256(831)), 831, 1));
    }

    function testERC1271SignatureFromDifferentSignerFailsWithoutStateChange() public {
        _useContractAgent();
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(841)), 841, 1);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(842)), 842, intentHash);
        bytes memory wrongSignature = _signature(ATTACKER_PRIVATE_KEY, intentHash);
        bytes memory authorizationSignature =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));

        _expectAgentFailureLeavesStateUnchanged(
            intent, wrongSignature, authorization, authorizationSignature
        );
    }

    function testERC1271SignatureForOriginalDigestRejectsModifiedIntent() public {
        _useContractAgent();
        CovenantTypes.PaymentIntent memory original = _intent(bytes32(uint256(851)), 851, 1);
        bytes memory originalSignature =
            _signature(AGENT_PRIVATE_KEY, vault.hashPaymentIntent(original));
        CovenantTypes.PaymentIntent memory modified = original;
        modified.invoiceHash = bytes32(uint256(852));
        bytes32 modifiedHash = vault.hashPaymentIntent(modified);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(853)), 853, modifiedHash);
        bytes memory authorizationSignature =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));

        _expectAgentFailureLeavesStateUnchanged(
            modified, originalSignature, authorization, authorizationSignature
        );
    }

    function testERC1271ReplayProtectionRemainsEnforced() public {
        _useContractAgent();
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(861)), 861, 1);
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(862)), 862);
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);

        vm.expectRevert(CovenantVault.ReplayDetected.selector);
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);
    }

    function testERC1271AgentStillRequiresValidEOAAuthorization() public {
        _useContractAgent();
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(871)), 871, 1);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        bytes memory intentSignature = _signature(AGENT_PRIVATE_KEY, intentHash);
        CovenantTypes.AuthorizationReceipt memory authorization =
            _authorization(bytes32(uint256(872)), 872, intentHash);
        bytes memory wrongAuthorization =
            _signature(ATTACKER_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));

        vm.expectRevert();
        vault.executePayment(intent, intentSignature, authorization, wrongAuthorization);
        assertEq(vault.totalSpent(), 0);
        assertEq(vault.paymentCount(), 0);
        assertFalse(vault.usedIntentHashes(intentHash));
    }

    function _useContractAgent() private {
        contractAgent = new MockERC1271Agent(vm.addr(AGENT_PRIVATE_KEY));
        agentSigner = address(contractAgent);
        vault = _deployVault(_configuration());
        vm.startPrank(issuer);
        token.approve(address(vault), type(uint256).max);
        vault.fund(10_000_000_000);
        vm.stopPrank();
    }

    function _assertAgentFailureLeavesStateUnchanged(CovenantTypes.PaymentIntent memory intent)
        private
    {
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, bytes32(uint256(intent.nonce + 1_000)), intent.nonce + 1_000);
        _expectAgentFailureLeavesStateUnchanged(
            intent, intentSignature, authorization, authorizationSignature
        );
    }

    function _expectAgentFailureLeavesStateUnchanged(
        CovenantTypes.PaymentIntent memory intent,
        bytes memory intentSignature,
        CovenantTypes.AuthorizationReceipt memory authorization,
        bytes memory authorizationSignature
    ) private {
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        uint256 recipientBalance = token.balanceOf(recipient);
        vm.expectRevert(
            abi.encodeWithSelector(CovenantVault.InvalidAgentSignature.selector, address(0))
        );
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);
        assertEq(token.balanceOf(recipient), recipientBalance);
        assertEq(vault.totalSpent(), 0);
        assertEq(vault.paymentCount(), 0);
        assertFalse(vault.usedIntentHashes(intentHash));
        assertFalse(vault.usedIntentIds(intent.intentId));
        assertFalse(vault.usedAgentNonces(intent.nonce));
        assertFalse(vault.usedAuthorizationIds(authorization.authorizationId));
        assertFalse(vault.usedAuthorizationNonces(authorization.authorizationNonce));
    }
}
