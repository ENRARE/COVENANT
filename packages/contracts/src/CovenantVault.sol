// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {CovenantHashing} from "./CovenantHashing.sol";
import {CovenantTypes} from "./CovenantTypes.sol";

/// @notice Immutable MVP vault for one Covenant and one six-decimal Arc Testnet USDC asset.
contract CovenantVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ARC_TESTNET_CHAIN_ID = 5_042_002;
    string public constant EIP712_DOMAIN_VERSION = "1";
    string public constant PAYMENT_INTENT_DOMAIN_NAME = "Covenant PaymentIntent";
    string public constant AUTHORIZATION_RECEIPT_DOMAIN_NAME = "Covenant AuthorizationReceipt";
    bytes32 public constant SCHEMA_VERSION_HASH = keccak256("1");
    bytes32 public constant PAYMENT_INTENT_TYPEHASH = CovenantHashing.PAYMENT_INTENT_TYPEHASH;
    bytes32 public constant AUTHORIZATION_RECEIPT_TYPEHASH =
        CovenantHashing.AUTHORIZATION_RECEIPT_TYPEHASH;

    bytes32 public immutable covenantId;
    address public immutable issuer;
    address public immutable agentSigner;
    address public immutable authorizationSigner;
    IERC20 public immutable token;
    address public immutable recipient;
    uint256 public immutable maxAmountPerPayment;
    uint256 public immutable totalBudget;
    uint256 public immutable maxPaymentCount;
    uint256 public immutable validAfter;
    uint256 public immutable validUntil;
    bytes32 public immutable purposeHash;
    bytes32 public immutable policyHash;
    bytes32 public immutable policyVersionHash;

    bool public revoked;
    uint256 public totalSpent;
    uint256 public paymentCount;

    mapping(bytes32 intentHash => bool used) public usedIntentHashes;
    mapping(bytes32 intentId => bool used) public usedIntentIds;
    mapping(uint256 agentNonce => bool used) public usedAgentNonces;
    mapping(bytes32 authorizationId => bool used) public usedAuthorizationIds;
    mapping(uint256 authorizationNonce => bool used) public usedAuthorizationNonces;

    error WrongChain(uint256 actualChainId);
    error UnauthorizedCaller(address caller);
    error ZeroAddress();
    error InvalidConfiguration();
    error ZeroAmount();
    error CovenantNotActive();
    error CovenantIsRevoked();
    error CovenantAlreadyRevoked();
    error WithdrawalUnavailable();
    error InvalidPaymentIntent();
    error InvalidAuthorizationReceipt();
    error InvalidAgentSignature(address recovered);
    error InvalidAuthorizationSignature(address recovered);
    error ReplayDetected();
    error TotalBudgetExceeded();
    error PaymentCountExceeded();

    event CovenantFunded(address indexed issuer, uint256 amount);
    event CovenantRevoked(address indexed issuer);
    event RemainingFundsWithdrawn(address indexed issuer, uint256 amount);
    event PaymentExecuted(
        bytes32 indexed covenantId,
        bytes32 indexed intentId,
        bytes32 intentHash,
        bytes32 indexed authorizationId,
        bytes32 decisionId,
        uint256 authorizationNonce,
        address recipient,
        uint256 amount,
        uint256 totalSpent,
        uint256 paymentCount
    );

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert UnauthorizedCaller(msg.sender);
        _;
    }

    constructor(CovenantTypes.Configuration memory configuration)
        EIP712(PAYMENT_INTENT_DOMAIN_NAME, EIP712_DOMAIN_VERSION)
    {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        _validateConfiguration(configuration);

        covenantId = configuration.covenantId;
        issuer = configuration.issuer;
        agentSigner = configuration.agentSigner;
        authorizationSigner = configuration.authorizationSigner;
        token = IERC20(configuration.token);
        recipient = configuration.recipient;
        maxAmountPerPayment = configuration.maxAmountPerPayment;
        totalBudget = configuration.totalBudget;
        maxPaymentCount = configuration.maxPaymentCount;
        validAfter = configuration.validAfter;
        validUntil = configuration.validUntil;
        purposeHash = keccak256(bytes(configuration.purpose));
        policyHash = configuration.policyHash;
        policyVersionHash = keccak256(bytes(configuration.policyVersion));
    }

    function fund(uint256 amount) external onlyIssuer nonReentrant {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit CovenantFunded(msg.sender, amount);
    }

    function revoke() external onlyIssuer {
        if (revoked) revert CovenantAlreadyRevoked();
        revoked = true;
        emit CovenantRevoked(msg.sender);
    }

    function withdrawRemaining() external onlyIssuer nonReentrant {
        if (!revoked && block.timestamp < validUntil) revert WithdrawalUnavailable();
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(issuer, amount);
        emit RemainingFundsWithdrawn(issuer, amount);
    }

    function executePayment(
        CovenantTypes.PaymentIntent calldata intent,
        bytes calldata intentSignature,
        CovenantTypes.AuthorizationReceipt calldata authorization,
        bytes calldata authorizationSignature
    ) external nonReentrant {
        _requireActiveCovenant();
        _validateIntent(intent);

        bytes32 intentHash = hashPaymentIntent(intent);
        address recoveredAgent = ECDSA.recoverCalldata(intentHash, intentSignature);
        if (recoveredAgent == address(0) || recoveredAgent != agentSigner) {
            revert InvalidAgentSignature(recoveredAgent);
        }

        _validateAuthorization(authorization, intent, intentHash);
        bytes32 authorizationHash = hashAuthorizationReceipt(authorization);
        address recoveredAuthorizationSigner =
            ECDSA.recoverCalldata(authorizationHash, authorizationSignature);
        if (
            recoveredAuthorizationSigner == address(0)
                || recoveredAuthorizationSigner != authorizationSigner
        ) {
            revert InvalidAuthorizationSignature(recoveredAuthorizationSigner);
        }

        if (
            usedIntentHashes[intentHash] || usedIntentIds[intent.intentId]
                || usedAgentNonces[intent.nonce]
                || usedAuthorizationIds[authorization.authorizationId]
                || usedAuthorizationNonces[authorization.authorizationNonce]
        ) revert ReplayDetected();
        if (paymentCount >= maxPaymentCount) revert PaymentCountExceeded();
        if (intent.amount > totalBudget - totalSpent) revert TotalBudgetExceeded();

        usedIntentHashes[intentHash] = true;
        usedIntentIds[intent.intentId] = true;
        usedAgentNonces[intent.nonce] = true;
        usedAuthorizationIds[authorization.authorizationId] = true;
        usedAuthorizationNonces[authorization.authorizationNonce] = true;
        totalSpent += intent.amount;
        paymentCount += 1;

        token.safeTransfer(recipient, intent.amount);

        _emitPaymentExecuted(intent, authorization, intentHash);
    }

    function hashPaymentIntentStruct(CovenantTypes.PaymentIntent calldata intent)
        public
        pure
        returns (bytes32)
    {
        return CovenantHashing.hashPaymentIntentStruct(intent);
    }

    function hashPaymentIntent(CovenantTypes.PaymentIntent calldata intent)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(hashPaymentIntentStruct(intent));
    }

    function hashAuthorizationReceiptStruct(
        CovenantTypes.AuthorizationReceipt calldata authorization
    ) public pure returns (bytes32) {
        return CovenantHashing.hashAuthorizationReceiptStruct(authorization);
    }

    function hashAuthorizationReceipt(CovenantTypes.AuthorizationReceipt calldata authorization)
        public
        view
        returns (bytes32)
    {
        return CovenantHashing.typedDataDigest(
            authorizationReceiptDomainSeparator(), hashAuthorizationReceiptStruct(authorization)
        );
    }

    function paymentIntentDomainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function authorizationReceiptDomainSeparator() public view returns (bytes32) {
        return CovenantHashing.domainSeparator(
            CovenantHashing.AUTHORIZATION_RECEIPT_DOMAIN_NAME_HASH, block.chainid, address(this)
        );
    }

    function _requireActiveCovenant() private view {
        if (revoked) revert CovenantIsRevoked();
        if (
            block.chainid != ARC_TESTNET_CHAIN_ID || block.timestamp < validAfter
                || block.timestamp >= validUntil
        ) revert CovenantNotActive();
    }

    function _validateIntent(CovenantTypes.PaymentIntent calldata intent) private view {
        if (
            keccak256(bytes(intent.version)) != SCHEMA_VERSION_HASH
                || intent.covenantId != covenantId || intent.agentSigner != agentSigner
                || intent.recipient != recipient || intent.token != address(token)
                || keccak256(bytes(intent.purpose)) != purposeHash || intent.amount == 0
                || intent.amount > maxAmountPerPayment || intent.createdAt < validAfter
                || intent.createdAt >= intent.expiresAt || intent.expiresAt > validUntil
                || block.timestamp < intent.createdAt || block.timestamp >= intent.expiresAt
        ) revert InvalidPaymentIntent();
    }

    function _validateAuthorization(
        CovenantTypes.AuthorizationReceipt calldata authorization,
        CovenantTypes.PaymentIntent calldata intent,
        bytes32 intentHash
    ) private view {
        if (
            keccak256(bytes(authorization.version)) != SCHEMA_VERSION_HASH
                || authorization.decisionId == bytes32(0) || authorization.covenantId != covenantId
                || authorization.intentHash != intentHash
                || authorization.vaultAddress != address(this)
                || authorization.chainId != block.chainid
                || keccak256(bytes(authorization.policyVersion)) != policyVersionHash
                || authorization.signer != authorizationSigner
                || authorization.validUntil > intent.expiresAt
                || authorization.validUntil > validUntil
                || block.timestamp >= authorization.validUntil
        ) revert InvalidAuthorizationReceipt();
    }

    function _validateConfiguration(CovenantTypes.Configuration memory configuration) private view {
        if (
            configuration.issuer == address(0) || configuration.agentSigner == address(0)
                || configuration.authorizationSigner == address(0)
                || configuration.token == address(0) || configuration.recipient == address(0)
        ) revert ZeroAddress();
        if (
            configuration.issuer == configuration.agentSigner
                || configuration.issuer == configuration.authorizationSigner
                || configuration.agentSigner == configuration.authorizationSigner
                || configuration.recipient == configuration.issuer
                || configuration.recipient == configuration.agentSigner
                || configuration.recipient == configuration.authorizationSigner
                || configuration.recipient == configuration.token
                || configuration.recipient == address(this)
                || configuration.maxAmountPerPayment == 0 || configuration.totalBudget == 0
                || configuration.maxPaymentCount == 0
                || configuration.maxAmountPerPayment > configuration.totalBudget
                || configuration.validAfter == 0
                || configuration.validUntil <= configuration.validAfter
                || bytes(configuration.purpose).length == 0
                || bytes(configuration.purpose).length > 256
                || bytes(configuration.policyVersion).length == 0
                || bytes(configuration.policyVersion).length > 32
        ) revert InvalidConfiguration();
    }

    function _emitPaymentExecuted(
        CovenantTypes.PaymentIntent calldata intent,
        CovenantTypes.AuthorizationReceipt calldata authorization,
        bytes32 intentHash
    ) private {
        emit PaymentExecuted(
            covenantId,
            intent.intentId,
            intentHash,
            authorization.authorizationId,
            authorization.decisionId,
            authorization.authorizationNonce,
            recipient,
            intent.amount,
            totalSpent,
            paymentCount
        );
    }
}
