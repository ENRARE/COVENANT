import {
  createExecutorDeploymentService,
  type ExecutorDeploymentService,
} from "./deployment-service-factory.js";

export * from "./deployment-service-factory.js";

/**
 * Railway loads this module through COVENANT_EXECUTOR_SERVICE_MODULE. The
 * top-level await keeps configuration, Arc-chain, signer, and journal checks
 * inside worker startup; no partially configured service is exported.
 */
const service: ExecutorDeploymentService =
  await createExecutorDeploymentService();

export default service;
