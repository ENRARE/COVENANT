import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  InMemoryProposalReservationRepository,
  PAYMENT_INTENT_TTL_SECONDS,
  createAgentService,
} from "@covenant/agent";
import { createAuthorityService } from "@covenant/authority";
import { parseCov018LivePublicConfiguration } from "@covenant/config";
import { createExecutorService } from "@covenant/executor";
import {
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  deriveSigningDomainForCovenant,
  hashAuthorizationReceipt,
  hashInvoice,
  parseUsdc,
  verifyAuthorizationChain,
} from "@covenant/spec";
import { encodeAbiParameters, keccak256 } from "viem";

function minimum(...values) {
  return values.reduce((smallest, value) =>
    value < smallest ? value : smallest,
  );
}

function transactionDigest(request) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes" },
      ],
      [request.chainId, request.to, request.value, request.data],
    ),
  );
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error("Isolated signer configuration is unavailable");
  return value;
}

function signerEnvironment(values) {
  return Object.freeze({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    ...values,
  });
}

function stringifyTypedData(value) {
  return JSON.stringify(value, (_, nested) =>
    typeof nested === "bigint" ? nested.toString() : nested,
  );
}

function signWithProcess(moduleUrl, environment, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(moduleUrl)], {
      env: environment,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const chunks = [];
    let size = 0;
    child.stdout.on("data", (chunk) => {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size <= 1024) chunks.push(bytes);
    });
    child.once("error", () => reject(new Error("Isolated signing failed")));
    child.once("close", (code) => {
      const signature = Buffer.concat(chunks).toString("utf8").trim();
      if (
        code !== 0 ||
        size > 1024 ||
        !/^0x[0-9a-fA-F]{130}$/u.test(signature)
      ) {
        reject(new Error("Isolated signing failed"));
      } else {
        resolve(signature);
      }
    });
    child.stdin.end(stringifyTypedData(request));
  });
}

function createProcessSigners(configuration) {
  const vendorEnvironment = signerEnvironment({
    COVENANT_VENDOR_KEYSTORE_PATH: requiredEnvironment(
      "COVENANT_VENDOR_KEYSTORE_PATH",
    ),
    COVENANT_VENDOR_PASSWORD_FILE: requiredEnvironment(
      "COVENANT_VENDOR_PASSWORD_FILE",
    ),
    COVENANT_VENDOR_SIGNER_ADDRESS: configuration.approvedVendor,
    COVENANT_VENDOR_RECIPIENT: configuration.recipientAddress,
    COVENANT_VENDOR_TOKEN: configuration.tokenAddress,
    COVENANT_VENDOR_PRODUCT_ID: configuration.approvedProductId,
    COVENANT_VENDOR_PURPOSE: configuration.purpose,
    COVENANT_VENDOR_MAXIMUM_BASE_UNITS:
      configuration.maxAmountPerPaymentBaseUnits,
  });
  const agentEnvironment = signerEnvironment({
    COVENANT_AGENT_KEYSTORE_PATH: requiredEnvironment(
      "COVENANT_AGENT_KEYSTORE_PATH",
    ),
    COVENANT_AGENT_PASSWORD_FILE: requiredEnvironment(
      "COVENANT_AGENT_PASSWORD_FILE",
    ),
    COVENANT_AGENT_SIGNER_ADDRESS: configuration.agentSigner,
  });
  const authorizationEnvironment = signerEnvironment({
    COVENANT_AUTHORIZATION_KEYSTORE_PATH: requiredEnvironment(
      "COVENANT_AUTHORIZATION_KEYSTORE_PATH",
    ),
    COVENANT_AUTHORIZATION_PASSWORD_FILE: requiredEnvironment(
      "COVENANT_AUTHORIZATION_PASSWORD_FILE",
    ),
    COVENANT_AUTHORIZATION_SIGNER_ADDRESS: configuration.authorizationSigner,
  });
  return Object.freeze({
    vendorSigner: Object.freeze({
      address: configuration.approvedVendor,
      signInvoice: (typedData) =>
        signWithProcess(
          new URL("../../apps/vendor/dist/cli.js", import.meta.url),
          vendorEnvironment,
          typedData,
        ),
    }),
    agentSigner: Object.freeze({
      address: configuration.agentSigner,
      signPaymentIntent: (typedData) =>
        signWithProcess(
          new URL("../../apps/agent/dist/signer-cli.js", import.meta.url),
          agentEnvironment,
          typedData,
        ),
    }),
    authorizationSigner: Object.freeze({
      address: configuration.authorizationSigner,
      signDecisionReceipt: (typedData) =>
        signWithProcess(
          new URL("../../apps/authority/dist/signer-cli.js", import.meta.url),
          authorizationEnvironment,
          { kind: "decision", typedData },
        ),
      signAuthorizationReceipt: (typedData) =>
        signWithProcess(
          new URL("../../apps/authority/dist/signer-cli.js", import.meta.url),
          authorizationEnvironment,
          { kind: "authorization", typedData },
        ),
    }),
  });
}

function covenantFromConfiguration(configuration) {
  return Object.freeze({
    version: "1",
    covenantId: configuration.covenantId,
    issuer: configuration.issuer,
    agentSigner: configuration.agentSigner,
    authorizationSigner: configuration.authorizationSigner,
    vaultAddress: configuration.vaultAddress,
    chainId: configuration.chainId,
    tokenAddress: configuration.tokenAddress,
    recipientAddress: configuration.recipientAddress,
    maxAmountPerPayment: configuration.maxAmountPerPayment,
    totalBudget: configuration.totalBudget,
    maxPaymentCount: configuration.maxPaymentCount,
    validAfter: configuration.validAfter.toString(),
    validUntil: configuration.validUntil.toString(),
    purpose: configuration.purpose,
    policyHash: configuration.policyHash,
    policyVersion: configuration.policyVersion,
    createdAt: configuration.createdAt.toString(),
  });
}

export async function prepareLiveSignedFlow(input) {
  const configuration = parseCov018LivePublicConfiguration(input.configuration);
  const now = BigInt(input.now);
  if (now < configuration.validAfter || now >= configuration.validUntil) {
    throw new Error("Preparation time is outside the Covenant validity window");
  }
  const covenant = covenantFromConfiguration(configuration);
  const invoiceDomain = deriveSigningDomainForCovenant(
    covenant,
    EIP712_DOMAIN_NAMES.invoice,
  );
  const invoice = Object.freeze({
    version: "1",
    invoiceId: await input.identifiers.create("invoice"),
    vendor: configuration.approvedVendor,
    recipient: configuration.recipientAddress,
    token: configuration.tokenAddress,
    amount: configuration.plannedAmount,
    productId: configuration.approvedProductId,
    purpose: configuration.purpose,
    issuedAt: now.toString(),
    expiresAt: minimum(now + 600n, configuration.validUntil).toString(),
    nonce: String(await input.nonces.create("invoice")),
  });
  const signedInvoice = Object.freeze({
    payload: invoice,
    signature: await input.vendorSigner.signInvoice(
      buildInvoiceTypedData(invoice, invoiceDomain),
    ),
  });

  const agent = createAgentService({
    clock: { now: () => now },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    signer: input.agentSigner,
    identifierGenerator: {
      createId: () => input.identifiers.create("intent"),
    },
    reservationRepository: new InMemoryProposalReservationRepository(),
    approvedVendor: configuration.approvedVendor,
    approvedProductId: configuration.approvedProductId,
    intentTtlSeconds: PAYMENT_INTENT_TTL_SECONDS,
  });
  const agentResult = await agent.proposePayment({
    signedInvoice,
    procurementRequest: {
      productId: configuration.approvedProductId,
      expectedAmount: configuration.plannedAmount,
    },
  });

  const authority = createAuthorityService({
    clock: { now: () => now },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    evidenceReader: {
      readEvidence: () =>
        Promise.resolve({
          chainId: 5_042_002n,
          vaultAddress: configuration.vaultAddress,
          observedAt: now,
          revoked: false,
          totalSpent: 0n,
          paymentCount: 0n,
          usedIntentHash: false,
          usedIntentId: false,
          usedAgentNonce: false,
        }),
      isAuthorizationNonceUsed: () => Promise.resolve(false),
    },
    identifierGenerator: {
      createId: (kind) => input.identifiers.create(kind),
    },
    signer: input.authorizationSigner,
    approvedVendor: configuration.approvedVendor,
    approvedProductId: configuration.approvedProductId,
  });
  const authorityResult = await authority.processPaymentRequest(agentResult);
  if (authorityResult.status !== "APPROVED") {
    throw new Error("Authority did not approve the exact payment");
  }
  const executorRequest = Object.freeze({
    signedPaymentIntent: agentResult.signedPaymentIntent,
    ruleResults: authorityResult.ruleResults,
    decisionReceipt: authorityResult.decisionReceipt,
    authorizationReceipt: authorityResult.authorizationReceipt,
  });
  await verifyAuthorizationChain(
    covenant,
    executorRequest.signedPaymentIntent,
    executorRequest.decisionReceipt,
    executorRequest.ruleResults,
    executorRequest.authorizationReceipt,
  );

  let submitted = false;
  let authorizedTransaction;
  const executor = createExecutorService({
    clock: { now: () => now },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    transport: Object.freeze({
      simulate(request) {
        authorizedTransaction = Object.freeze({ ...request });
        return Promise.resolve(Object.freeze({ status: "SIMULATED" }));
      },
      submit() {
        submitted = true;
        return Promise.reject(new Error("Submission is forbidden"));
      },
    }),
  });
  const simulation = await executor.simulateAuthorizedPayment(executorRequest);
  if (submitted || authorizedTransaction === undefined) {
    throw new Error("Offline preparation violated the execution boundary");
  }
  input.observePreparedTransaction?.(authorizedTransaction);

  const intent = agentResult.signedPaymentIntent.payload;
  if (
    parseUsdc(intent.amount) !== BigInt(configuration.plannedAmountBaseUnits)
  ) {
    throw new Error(
      "Prepared amount does not match the reviewed configuration",
    );
  }
  const decision = authorityResult.decisionReceipt.payload;
  const authorization = authorityResult.authorizationReceipt.payload;
  const authorizationDomain = deriveSigningDomainForCovenant(
    covenant,
    EIP712_DOMAIN_NAMES.authorizationReceipt,
  );
  return Object.freeze({
    covenantId: configuration.covenantId,
    invoiceId: invoice.invoiceId,
    invoiceHash: hashInvoice(invoice, invoiceDomain),
    intentId: intent.intentId,
    intentHash: simulation.execution.intentDigest,
    agentNonce: intent.nonce.toString(),
    intentCreatedAt: intent.createdAt.toString(),
    intentExpiresAt: intent.expiresAt.toString(),
    decisionId: decision.decisionId,
    authorizationId: authorization.authorizationId,
    authorizationHash: hashAuthorizationReceipt(
      authorization,
      authorizationDomain,
    ),
    authorizationNonce: authorization.authorizationNonce.toString(),
    authorizationValidUntil: authorization.validUntil.toString(),
    executionId: simulation.execution.executionId,
    transactionDigest: transactionDigest(authorizedTransaction),
    target: authorizedTransaction.to,
    chainId: authorizedTransaction.chainId.toString(),
    value: authorizedTransaction.value.toString(),
    calldataHash: keccak256(authorizedTransaction.data),
    calldataByteLength: (authorizedTransaction.data.length - 2) / 2,
    token: intent.token,
    recipient: intent.recipient,
    amount: configuration.plannedAmountBaseUnits,
  });
}

export function assertExecutorProcessEnvironment(environment) {
  const forbidden = [
    "COVENANT_VENDOR_KEYSTORE_PATH",
    "COVENANT_VENDOR_PASSWORD_FILE",
    "COVENANT_AGENT_KEYSTORE_PATH",
    "COVENANT_AGENT_PASSWORD_FILE",
    "COVENANT_AUTHORIZATION_KEYSTORE_PATH",
    "COVENANT_AUTHORIZATION_PASSWORD_FILE",
    "COVENANT_ISSUER_KEYSTORE_PATH",
    "COVENANT_ISSUER_PASSWORD_FILE",
  ];
  if (forbidden.some((name) => environment[name] !== undefined)) {
    throw new Error("Signer material is forbidden in the executor process");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const configurationPath = process.argv[2];
  if (!configurationPath) {
    process.stderr.write("Usage: pnpm cov018:prepare <public-config.json>\n");
    process.exitCode = 1;
  } else {
    readFile(configurationPath, "utf8")
      .then(JSON.parse)
      .then((rawConfiguration) => {
        const configuration =
          parseCov018LivePublicConfiguration(rawConfiguration);
        const signers = createProcessSigners(configuration);
        return prepareLiveSignedFlow({
          configuration: rawConfiguration,
          now: BigInt(Math.floor(Date.now() / 1000)),
          identifiers: {
            create: async () => `0x${randomBytes(32).toString("hex")}`,
          },
          nonces: {
            create: async () => BigInt(`0x${randomBytes(16).toString("hex")}`),
          },
          ...signers,
        });
      })
      .then((metadata) => process.stdout.write(`${JSON.stringify(metadata)}\n`))
      .catch(() => {
        process.stderr.write("Offline preparation failed\n");
        process.exitCode = 1;
      });
  }
}
