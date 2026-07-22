// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

abstract contract CovenantVaultTestBase is Test {
    uint256 internal constant AGENT_PRIVATE_KEY = uint256(keccak256("covenant-agent"));
    uint256 internal constant AUTHORIZATION_PRIVATE_KEY =
        uint256(keccak256("covenant-authorization"));
    uint256 internal constant ATTACKER_PRIVATE_KEY = uint256(keccak256("covenant-attacker"));

    bytes32 internal constant COVENANT_ID = bytes32(uint256(1));
    bytes32 internal constant POLICY_HASH = bytes32(uint256(7));
    string internal constant PURPOSE = "Purchase approved GPU compute";
    string internal constant POLICY_VERSION = "gpu-policy-1";

    address internal issuer = makeAddr("issuer");
    address internal deployer = makeAddr("third-party-deployer");
    address internal executor = makeAddr("permissionless-executor");
    address internal recipient = makeAddr("approved-recipient");
    address internal attacker = makeAddr("attacker");
    address internal agentSigner;
    address internal authorizationSigner;

    MockUSDC internal token;
    CovenantVault internal vault;

    function setUp() public virtual {
        vm.chainId(5_042_002);
        vm.warp(1_100);
        agentSigner = vm.addr(AGENT_PRIVATE_KEY);
        authorizationSigner = vm.addr(AUTHORIZATION_PRIVATE_KEY);
        token = new MockUSDC();
        vault = _deployVault(_configuration());
        token.mint(issuer, 20_000_000_000);
        vm.startPrank(issuer);
        token.approve(address(vault), type(uint256).max);
        vault.fund(10_000_000_000);
        vm.stopPrank();
    }

    function _configuration() internal view returns (CovenantTypes.Configuration memory) {
        return CovenantTypes.Configuration({
            covenantId: COVENANT_ID,
            issuer: issuer,
            agentSigner: agentSigner,
            authorizationSigner: authorizationSigner,
            token: address(token),
            recipient: recipient,
            maxAmountPerPayment: 5_000_000_000,
            totalBudget: 10_000_000_000,
            maxPaymentCount: 2,
            validAfter: 1_000,
            validUntil: 2_000,
            purpose: PURPOSE,
            policyHash: POLICY_HASH,
            policyVersion: POLICY_VERSION
        });
    }

    function _deployVault(CovenantTypes.Configuration memory configuration)
        internal
        returns (CovenantVault deployed)
    {
        vm.prank(deployer);
        deployed = new CovenantVault(configuration);
    }

    function _intent(bytes32 intentId, uint256 nonce, uint256 amount)
        internal
        view
        returns (CovenantTypes.PaymentIntent memory)
    {
        return CovenantTypes.PaymentIntent({
            version: "1",
            intentId: intentId,
            covenantId: COVENANT_ID,
            agentSigner: agentSigner,
            recipient: recipient,
            token: address(token),
            amount: amount,
            invoiceHash: bytes32(uint256(8)),
            purpose: PURPOSE,
            createdAt: 1_050,
            expiresAt: 1_500,
            nonce: nonce
        });
    }

    function _authorization(bytes32 authorizationId, uint256 nonce, bytes32 intentHash)
        internal
        view
        returns (CovenantTypes.AuthorizationReceipt memory)
    {
        return CovenantTypes.AuthorizationReceipt({
            version: "1",
            authorizationId: authorizationId,
            decisionId: bytes32(uint256(4)),
            covenantId: COVENANT_ID,
            intentHash: intentHash,
            vaultAddress: address(vault),
            chainId: block.chainid,
            policyVersion: POLICY_VERSION,
            authorizationNonce: nonce,
            validUntil: 1_400,
            signer: authorizationSigner
        });
    }

    function _signature(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signedPayment(
        CovenantTypes.PaymentIntent memory intent,
        bytes32 authorizationId,
        uint256 authorizationNonce
    )
        internal
        view
        returns (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        )
    {
        bytes32 intentHash = vault.hashPaymentIntent(intent);
        intentSignature = _signature(AGENT_PRIVATE_KEY, intentHash);
        authorization = _authorization(authorizationId, authorizationNonce, intentHash);
        authorizationSignature =
            _signature(AUTHORIZATION_PRIVATE_KEY, vault.hashAuthorizationReceipt(authorization));
    }

    function _execute(
        CovenantTypes.PaymentIntent memory intent,
        bytes32 authorizationId,
        uint256 authorizationNonce
    ) internal {
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, authorizationId, authorizationNonce);
        vm.prank(executor);
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);
    }

    function _expectExecutionRevert(
        bytes4 expectedError,
        CovenantTypes.PaymentIntent memory intent,
        bytes32 authorizationId,
        uint256 authorizationNonce
    ) internal {
        (
            bytes memory intentSignature,
            CovenantTypes.AuthorizationReceipt memory authorization,
            bytes memory authorizationSignature
        ) = _signedPayment(intent, authorizationId, authorizationNonce);
        vm.expectRevert(expectedError);
        vault.executePayment(intent, intentSignature, authorization, authorizationSignature);
    }

    function _highSTwin(bytes memory signature) internal pure returns (bytes memory) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        uint256 curveOrder = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 highS = bytes32(curveOrder - uint256(s));
        return abi.encodePacked(r, highS, v == 27 ? uint8(28) : uint8(27));
    }
}
