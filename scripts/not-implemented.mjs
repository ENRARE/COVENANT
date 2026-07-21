const subsystem = process.argv[2] ?? "requested-subsystem";

console.error(
  `[NOT IMPLEMENTED] ${subsystem} is outside COV-001 and is not ready.`,
);
process.exitCode = 2;
