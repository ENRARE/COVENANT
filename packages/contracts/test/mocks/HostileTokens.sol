// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract TestTokenBase {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "BALANCE");
        if (msg.sender != from) {
            require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract FalseReturnToken is TestTokenBase {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}

contract NoReturnToken is TestTokenBase {
    function transfer(address to, uint256 amount) external {
        _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        _move(from, to, amount);
    }
}

contract RevertingToken is TestTokenBase {
    function transfer(address, uint256) external pure returns (bool) {
        revert("TOKEN_REVERT");
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert("TOKEN_REVERT");
    }
}

contract FeeOnTransferToken is TestTokenBase {
    function transfer(address to, uint256 amount) external returns (bool) {
        _moveWithFee(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _moveWithFee(from, to, amount);
        return true;
    }

    function _moveWithFee(address from, address to, uint256 amount) private {
        uint256 fee = amount == 0 ? 0 : 1;
        require(balanceOf[from] >= amount, "BALANCE");
        if (msg.sender != from) {
            require(allowance[from][msg.sender] >= amount, "ALLOWANCE");
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
    }
}

contract SuccessWithoutTransferToken is TestTokenBase {
    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }
}
