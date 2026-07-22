// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {CovenantVaultTestBase} from "./CovenantVaultTestBase.t.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract CovenantVaultSignatureTest is CovenantVaultTestBase {
    function testFuzzArbitraryRsvCannotAuthenticateWrongSigner(
        bytes32 r,
        bytes32 s,
        uint8 v,
        bool agentPosition
    ) public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(191)), 191, 1);
        (
            bytes memory intentSig,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory authSig
        ) = _signedPayment(intent, bytes32(uint256(192)), 192);
        bytes32 digest =
            agentPosition ? vault.hashPaymentIntent(intent) : vault.hashAuthorizationReceipt(auth);
        (address recovered,,) = ECDSA.tryRecover(digest, v, r, s);
        vm.assume(recovered != (agentPosition ? agentSigner : authorizationSigner));
        bytes memory fuzzed = abi.encodePacked(r, s, v);
        vm.expectRevert();
        vault.executePayment(
            intent, agentPosition ? fuzzed : intentSig, auth, agentPosition ? authSig : fuzzed
        );
    }

    function testRejectsAllMalformedAgentAndAuthorizationSignatureForms() public {
        bytes[] memory bad = new bytes[](7);
        bad[0] = new bytes(65);
        bad[1] = abi.encodePacked(bytes32(0), bytes32(uint256(1)), uint8(27));
        bad[2] = abi.encodePacked(bytes32(uint256(1)), bytes32(0), uint8(27));
        bad[3] = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(1)), uint8(29));
        bad[4] = hex"12";
        bad[5] = new bytes(66);

        CovenantTypes.PaymentIntent memory seed = _intent(bytes32(uint256(201)), 201, 1);
        (bytes memory validIntent,,) = _signedPayment(seed, bytes32(uint256(301)), 301);
        bad[6] = _highSTwin(validIntent);
        for (uint256 i; i < bad.length; ++i) {
            _expectBadSignature(true, 400 + i, bad[i]);
            _expectBadSignature(false, 500 + i, bad[i]);
        }
    }

    function testWrongSignerFailsInBothSignaturePositions() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(601)), 601, 1);
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        CovenantTypes.AuthorizationReceipt memory auth =
            _authorization(bytes32(uint256(602)), 602, intentHash);
        bytes memory validIntent = _signature(AGENT_PRIVATE_KEY, intentHash);
        bytes memory validAuth =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(auth));
        bytes memory wrongIntent = _signature(ATTACKER_PRIVATE_KEY, intentHash);
        bytes memory wrongAuth =
            _signature(ATTACKER_PRIVATE_KEY, vault.hashAuthorizationReceipt(auth));
        vm.expectRevert();
        vault.executePayment(intent, wrongIntent, auth, validAuth);
        vm.expectRevert();
        vault.executePayment(intent, validIntent, auth, wrongAuth);
    }

    function testConsumedLowSAuthorizationCannotBeResubmittedAsHighSTwin() public {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(uint256(701)), 701, 1);
        (
            bytes memory intentSig,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory authSig
        ) = _signedPayment(intent, bytes32(uint256(702)), 702);
        vault.executePayment(intent, intentSig, auth, authSig);
        vm.expectRevert();
        vault.executePayment(intent, intentSig, auth, _highSTwin(authSig));
    }

    function _expectBadSignature(bool agentPosition, uint256 identity, bytes memory malformed)
        private
    {
        CovenantTypes.PaymentIntent memory intent = _intent(bytes32(identity), identity, 1);
        (
            bytes memory intentSig,
            CovenantTypes.AuthorizationReceipt memory auth,
            bytes memory authSig
        ) = _signedPayment(intent, bytes32(identity + 1_000), identity + 1_000);
        vm.expectRevert();
        vault.executePayment(
            intent, agentPosition ? malformed : intentSig, auth, agentPosition ? authSig : malformed
        );
    }
}
