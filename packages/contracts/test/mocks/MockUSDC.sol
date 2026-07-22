// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    address public failingSender;
    bool public transfersFail;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;

    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }

    function setTransferFailure(address sender, bool shouldFail) external {
        failingSender = sender;
        transfersFail = shouldFail;
    }

    function setCallback(address target, bytes calldata data) external {
        callbackTarget = target;
        callbackData = data;
        callbackAttempted = false;
        callbackSucceeded = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (transfersFail && from == failingSender) revert("MOCK_TRANSFER_FAILED");
        if (from == callbackTarget && callbackData.length != 0 && !callbackAttempted) {
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
        super._update(from, to, value);
    }
}
