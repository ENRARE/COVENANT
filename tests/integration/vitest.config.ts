export default {
  test: {
    environment: "node",
    include: ["tests/integration/*.test.ts"],
    testTimeout: 20_000,
  },
};
