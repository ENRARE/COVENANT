// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";

import {CovenantTypes} from "../src/CovenantTypes.sol";
import {CovenantVault} from "../src/CovenantVault.sol";

/// @notice Non-broadcast local simulation using only the synthetic frozen fixture addresses.
contract DeployCovenantVaultLocal is Script {
    function run() external returns (CovenantVault vault) {
        CovenantTypes.Configuration memory configuration = CovenantTypes.Configuration({
            covenantId: 0x0101010101010101010101010101010101010101010101010101010101010101,
            issuer: 0x7564105E977516C53bE337314c7E53838967bDaC,
            agentSigner: 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A,
            authorizationSigner: 0x1563915e194D8CfBA1943570603F7606A3115508,
            token: 0x5000000000000000000000000000000000000005,
            recipient: 0x6000000000000000000000000000000000000006,
            maxAmountPerPayment: 5_000_000_000,
            totalBudget: 10_000_000_000,
            maxPaymentCount: 2,
            validAfter: 1_784_563_200,
            validUntil: 1_785_168_000,
            purpose: "Purchase approved GPU compute",
            policyHash: 0x0707070707070707070707070707070707070707070707070707070707070707,
            policyVersion: "gpu-policy-1"
        });
        vault = new CovenantVault(configuration);
    }
}
