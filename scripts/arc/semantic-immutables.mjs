import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  padHex,
  stringToHex,
  toHex,
} from "viem";

const DOMAIN_NAME = "Covenant PaymentIntent";
const DOMAIN_VERSION = "1";
const DOMAIN_TYPE =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalSemanticImmutableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function semanticImmutableMapDigest(value) {
  return keccak256(stringToHex(canonicalSemanticImmutableJson(value)));
}

function canonicalType(node) {
  const typeString = node?.typeDescriptions?.typeString;
  if (["address", "bytes32", "uint256"].includes(typeString)) {
    return typeString;
  }
  if (typeString === "contract IERC20") return "address";
  if (
    typeString === "ShortString" &&
    node?.typeName?.nodeType === "UserDefinedTypeName"
  ) {
    return "bytes32";
  }
  throw new Error("Unsupported immutable Solidity type");
}

function validatedRawRanges(referenceMap, runtimeLength) {
  if (
    referenceMap === null ||
    typeof referenceMap !== "object" ||
    Array.isArray(referenceMap) ||
    Object.keys(referenceMap).length === 0
  ) {
    throw new Error("Invalid immutable reference map");
  }
  const allRanges = [];
  const byIdentifier = new Map();
  for (const [identifier, references] of Object.entries(referenceMap)) {
    if (!/^[1-9]\d*$/u.test(identifier) || !Array.isArray(references)) {
      throw new Error("Invalid immutable reference identifier");
    }
    if (references.length === 0) {
      throw new Error("Empty immutable reference collection");
    }
    const seen = new Set();
    const ranges = references
      .map((reference) => {
        const { start, length } = reference ?? {};
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(length) ||
          start < 0 ||
          length <= 0 ||
          start + length > runtimeLength
        ) {
          throw new Error("Immutable reference is out of bounds");
        }
        const identity = `${start}:${length}`;
        if (seen.has(identity)) {
          throw new Error("Duplicate immutable reference range");
        }
        seen.add(identity);
        const range = { start, length };
        allRanges.push(range);
        return range;
      })
      .sort(
        (left, right) => left.start - right.start || left.length - right.length,
      );
    byIdentifier.set(Number(identifier), ranges);
  }
  allRanges.sort(
    (left, right) => left.start - right.start || left.length - right.length,
  );
  for (let index = 1; index < allRanges.length; index += 1) {
    const previous = allRanges[index - 1];
    const current = allRanges[index];
    if (current.start < previous.start + previous.length) {
      throw new Error("Immutable reference ranges overlap");
    }
  }
  return { byIdentifier, allRanges };
}

export function validateImmutableReferenceMap(referenceMap, runtimeLength) {
  return Object.freeze(
    validatedRawRanges(referenceMap, runtimeLength).allRanges.map((range) =>
      Object.freeze({ ...range }),
    ),
  );
}

export function validateSemanticImmutableMap(semanticMap, runtimeLength) {
  if (!Array.isArray(semanticMap) || semanticMap.length === 0) {
    throw new Error("Invalid semantic immutable map");
  }
  const allRanges = [];
  let previousLabel;
  for (const entry of semanticMap) {
    const { label, ranges } = entry ?? {};
    if (
      typeof label !== "string" ||
      !/^[A-Za-z_]\w*\.[A-Za-z_]\w*:(?:address|bytes32|uint256)$/u.test(
        label,
      ) ||
      (previousLabel !== undefined && label <= previousLabel) ||
      !Array.isArray(ranges) ||
      ranges.length === 0
    ) {
      throw new Error("Invalid semantic immutable entry");
    }
    previousLabel = label;
    let previousRange;
    for (const range of ranges) {
      const { start, length } = range ?? {};
      if (
        typeof start !== "string" ||
        !/^(?:0|[1-9]\d*)$/u.test(start) ||
        typeof length !== "string" ||
        !/^[1-9]\d*$/u.test(length)
      ) {
        throw new Error("Invalid semantic immutable range");
      }
      const numericStart = Number(start);
      const numericLength = Number(length);
      if (
        !Number.isSafeInteger(numericStart) ||
        !Number.isSafeInteger(numericLength) ||
        numericStart + numericLength > runtimeLength ||
        (previousRange !== undefined &&
          (numericStart < previousRange.start ||
            (numericStart === previousRange.start &&
              numericLength <= previousRange.length)))
      ) {
        throw new Error("Invalid semantic immutable range");
      }
      previousRange = { start: numericStart, length: numericLength };
      allRanges.push(previousRange);
    }
  }
  allRanges.sort(
    (left, right) => left.start - right.start || left.length - right.length,
  );
  for (let index = 1; index < allRanges.length; index += 1) {
    const previous = allRanges[index - 1];
    const current = allRanges[index];
    if (current.start < previous.start + previous.length) {
      throw new Error("Semantic immutable ranges overlap");
    }
  }
  return Object.freeze(allRanges.map((range) => Object.freeze({ ...range })));
}

function collectVariableDeclarations(buildInfo) {
  const sources = buildInfo?.output?.sources;
  if (
    sources === null ||
    typeof sources !== "object" ||
    Array.isArray(sources)
  ) {
    throw new Error("Compiler AST output is unavailable");
  }
  const declarations = new Map();
  const visit = (node, declaringContract) => {
    if (node === null || typeof node !== "object") return;
    const contract =
      node.nodeType === "ContractDefinition" ? node.name : declaringContract;
    if (node.nodeType === "VariableDeclaration") {
      const matches = declarations.get(node.id) ?? [];
      matches.push({ node, declaringContract: contract });
      declarations.set(node.id, matches);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, contract);
      } else if (value !== null && typeof value === "object") {
        visit(value, contract);
      }
    }
  };
  for (const source of Object.values(sources)) visit(source?.ast, undefined);
  return declarations;
}

export function deriveSemanticImmutableMap(
  referenceMap,
  buildInfo,
  runtimeLength,
) {
  const { byIdentifier, allRanges } = validatedRawRanges(
    referenceMap,
    runtimeLength,
  );
  const declarations = collectVariableDeclarations(buildInfo);
  const labels = new Set();
  const semanticMap = [];
  for (const [identifier, ranges] of byIdentifier) {
    const matches = declarations.get(identifier) ?? [];
    if (matches.length !== 1) {
      throw new Error("Immutable AST identifier did not resolve uniquely");
    }
    const { node, declaringContract } = matches[0];
    if (
      node.mutability !== "immutable" ||
      typeof declaringContract !== "string" ||
      declaringContract.length === 0 ||
      typeof node.name !== "string" ||
      node.name.length === 0
    ) {
      throw new Error("Immutable AST identifier resolved incorrectly");
    }
    const label = `${declaringContract}.${node.name}:${canonicalType(node)}`;
    if (labels.has(label)) {
      throw new Error("Duplicate semantic immutable label");
    }
    labels.add(label);
    semanticMap.push({
      label,
      ranges: ranges.map(({ start, length }) => ({
        start: String(start),
        length: String(length),
      })),
    });
  }
  semanticMap.sort((left, right) =>
    left.label < right.label ? -1 : left.label > right.label ? 1 : 0,
  );
  const semanticRanges = semanticMap
    .flatMap(({ ranges }) =>
      ranges.map(({ start, length }) => ({
        start: Number(start),
        length: Number(length),
      })),
    )
    .sort(
      (left, right) => left.start - right.start || left.length - right.length,
    );
  if (
    semanticRanges.length !== allRanges.length ||
    semanticRanges.some(
      (range, index) =>
        range.start !== allRanges[index].start ||
        range.length !== allRanges[index].length,
    )
  ) {
    throw new Error("Semantic immutable range union mismatch");
  }
  const result = Object.freeze(
    semanticMap.map((entry) =>
      Object.freeze({
        label: entry.label,
        ranges: Object.freeze(
          entry.ranges.map((range) => Object.freeze(range)),
        ),
      }),
    ),
  );
  validateSemanticImmutableMap(result, runtimeLength);
  return result;
}

function canonicalUint256(value) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/u.test(value) ||
    BigInt(value) >= 1n << 256n
  ) {
    throw new Error("Invalid immutable uint256 value");
  }
  return padHex(toHex(BigInt(value)), { size: 32 });
}

function canonicalAddress(value) {
  if (!isAddress(value, { strict: false })) {
    throw new Error("Invalid immutable address value");
  }
  return padHex(getAddress(value).toLowerCase(), { size: 32 });
}

function canonicalBytes32(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error("Invalid immutable bytes32 value");
  }
  return value.toLowerCase();
}

function shortString(value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 31) throw new Error("Invalid immutable ShortString value");
  const encoded = new Uint8Array(32);
  encoded.set(bytes);
  encoded[31] = bytes.length;
  return toHex(encoded);
}

export function expectedCovenantImmutableValues(input) {
  const configuration = input?.constructor;
  const chainId = input?.chainId;
  const contractAddress = input?.contractAddress;
  if (
    configuration === null ||
    typeof configuration !== "object" ||
    typeof chainId !== "string"
  ) {
    throw new Error("Invalid immutable value context");
  }
  const address = getAddress(contractAddress);
  const hashedName = keccak256(stringToHex(DOMAIN_NAME));
  const hashedVersion = keccak256(stringToHex(DOMAIN_VERSION));
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [
        keccak256(stringToHex(DOMAIN_TYPE)),
        hashedName,
        hashedVersion,
        BigInt(chainId),
        address,
      ],
    ),
  );
  return Object.freeze({
    "CovenantVault.agentSigner:address": canonicalAddress(
      configuration.agentSigner,
    ),
    "CovenantVault.authorizationSigner:address": canonicalAddress(
      configuration.authorizationSigner,
    ),
    "CovenantVault.covenantId:bytes32": canonicalBytes32(
      configuration.covenantId,
    ),
    "CovenantVault.issuer:address": canonicalAddress(configuration.issuer),
    "CovenantVault.maxAmountPerPayment:uint256": canonicalUint256(
      configuration.maxAmountPerPayment,
    ),
    "CovenantVault.maxPaymentCount:uint256": canonicalUint256(
      configuration.maxPaymentCount,
    ),
    "CovenantVault.policyHash:bytes32": canonicalBytes32(
      configuration.policyHash,
    ),
    "CovenantVault.policyVersionHash:bytes32": keccak256(
      stringToHex(configuration.policyVersion),
    ),
    "CovenantVault.purposeHash:bytes32": keccak256(
      stringToHex(configuration.purpose),
    ),
    "CovenantVault.recipient:address": canonicalAddress(
      configuration.recipient,
    ),
    "CovenantVault.token:address": canonicalAddress(configuration.token),
    "CovenantVault.totalBudget:uint256": canonicalUint256(
      configuration.totalBudget,
    ),
    "CovenantVault.validAfter:uint256": canonicalUint256(
      configuration.validAfter,
    ),
    "CovenantVault.validUntil:uint256": canonicalUint256(
      configuration.validUntil,
    ),
    "EIP712._cachedChainId:uint256": canonicalUint256(chainId),
    "EIP712._cachedDomainSeparator:bytes32": domainSeparator,
    "EIP712._cachedThis:address": canonicalAddress(address),
    "EIP712._hashedName:bytes32": hashedName,
    "EIP712._hashedVersion:bytes32": hashedVersion,
    "EIP712._name:bytes32": shortString(DOMAIN_NAME),
    "EIP712._version:bytes32": shortString(DOMAIN_VERSION),
  });
}

export function validateSemanticImmutableValues(semanticMap, values) {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Invalid semantic immutable values");
  }
  const expectedLabels = semanticMap.map(({ label }) => label).sort();
  const actualLabels = Object.keys(values).sort();
  if (
    expectedLabels.length !== actualLabels.length ||
    expectedLabels.some((label, index) => label !== actualLabels[index])
  ) {
    throw new Error("Semantic immutable values do not cover the reviewed map");
  }
  return Object.fromEntries(
    expectedLabels.map((label) => [label, canonicalBytes32(values[label])]),
  );
}
