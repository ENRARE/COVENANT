export default {
  test: {
    environment: "node",
    include: ["tests/contract-evidence/*.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
};
