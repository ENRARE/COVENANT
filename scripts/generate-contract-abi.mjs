import { generateCovenantVaultAbi } from "./contract-abi.mjs";

generateCovenantVaultAbi();
process.stdout.write("Generated packages/contracts/abi/CovenantVault.json\n");
