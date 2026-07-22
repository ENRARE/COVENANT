// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";

contract CovenantVaultConstructorTest is CovenantVaultTestBase {
    function testIssuerNeedNotBeDeployer() public view {
        assertTrue(vault.issuer() != deployer);
    }

    function testRejectsZeroIssuer() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.issuer = address(0);
        _zero(c);
    }

    function testRejectsZeroAgentSigner() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.agentSigner = address(0);
        _zero(c);
    }

    function testRejectsZeroAuthorizationSigner() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.authorizationSigner = address(0);
        _zero(c);
    }

    function testRejectsZeroToken() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.token = address(0);
        _zero(c);
    }

    function testRejectsZeroRecipient() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.recipient = address(0);
        _zero(c);
    }

    function testRejectsIssuerAgentCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.agentSigner = c.issuer;
        _invalid(c);
    }

    function testRejectsIssuerAuthorizationCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.authorizationSigner = c.issuer;
        _invalid(c);
    }

    function testRejectsAgentAuthorizationCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.authorizationSigner = c.agentSigner;
        _invalid(c);
    }

    function testRejectsRecipientIssuerCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.recipient = c.issuer;
        _invalid(c);
    }

    function testRejectsRecipientAgentCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.recipient = c.agentSigner;
        _invalid(c);
    }

    function testRejectsRecipientAuthorizationCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.recipient = c.authorizationSigner;
        _invalid(c);
    }

    function testRejectsRecipientTokenCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.recipient = c.token;
        _invalid(c);
    }

    function testRejectsRecipientVaultCollision() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.recipient = vm.computeCreateAddress(deployer, vm.getNonce(deployer));
        _invalid(c);
    }

    function testRejectsZeroMaximumAmount() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.maxAmountPerPayment = 0;
        _invalid(c);
    }

    function testRejectsZeroTotalBudget() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.totalBudget = 0;
        _invalid(c);
    }

    function testRejectsMaximumAboveBudget() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.maxAmountPerPayment = c.totalBudget + 1;
        _invalid(c);
    }

    function testRejectsZeroPaymentCount() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.maxPaymentCount = 0;
        _invalid(c);
    }

    function testRejectsZeroValidAfter() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.validAfter = 0;
        _invalid(c);
    }

    function testRejectsEqualValidityBounds() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.validUntil = c.validAfter;
        _invalid(c);
    }

    function testRejectsReversedValidityBounds() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.validUntil = c.validAfter - 1;
        _invalid(c);
    }

    function testRejectsEmptyPurpose() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.purpose = "";
        _invalid(c);
    }

    function testRejectsWhitespaceOnlyPurpose() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.purpose = " ";
        _invalid(c);
    }

    function testRejectsOversizedPurpose() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.purpose = string(new bytes(257));
        _invalid(c);
    }

    function testRejectsEmptyPolicyVersion() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.policyVersion = "";
        _invalid(c);
    }

    function testRejectsOversizedPolicyVersion() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.policyVersion = string(new bytes(33));
        _invalid(c);
    }

    function testRejectsInvalidPolicyVersionCharacters() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.policyVersion = "gpu policy";
        _invalid(c);
    }

    function testRejectsPolicyVersionBeginningWithPunctuation() public {
        CovenantTypes.Configuration memory c = _configuration();
        c.policyVersion = ".gpu-policy";
        _invalid(c);
    }

    function testRejectsDeploymentOutsideArcTestnet() public {
        CovenantTypes.Configuration memory c = _configuration();
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(CovenantVault.WrongChain.selector, 1));
        new CovenantVault(c);
    }

    function _zero(CovenantTypes.Configuration memory c) private {
        vm.expectRevert(CovenantVault.ZeroAddress.selector);
        new CovenantVault(c);
    }

    function _invalid(CovenantTypes.Configuration memory c) private {
        vm.expectRevert(CovenantVault.InvalidConfiguration.selector);
        vm.prank(deployer);
        new CovenantVault(c);
    }
}
