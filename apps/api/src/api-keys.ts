import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKeyRecord, RuntimeStore } from "@covenant/runtime";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function id(prefix: string): string {
  return `${prefix}${randomBytes(12).toString("base64url")}`;
}

export type ProvisionedProject = Readonly<{
  projectId: string;
  name: string;
  apiKey: string;
  keyId: string;
}>;

export class ApiKeyService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly now: () => number,
  ) {}

  async provisionProject(
    name = "Developer project",
  ): Promise<ProvisionedProject> {
    const projectId = `0x${randomBytes(32).toString("hex")}`;
    await this.store.ensureDeveloperProject(projectId, name, this.now());
    const tokenValue = `cov_test_${randomBytes(32).toString("base64url")}`;
    const keyId = id("key_");
    await this.store.saveApiKey({
      keyId,
      projectId,
      prefix: tokenValue.slice(0, 18),
      digest: digest(tokenValue),
      at: this.now(),
    });
    return { projectId, name, apiKey: tokenValue, keyId };
  }

  async createKey(
    projectId: string,
  ): Promise<Readonly<{ keyId: string; apiKey: string; prefix: string }>> {
    const tokenValue = `cov_test_${randomBytes(32).toString("base64url")}`;
    const keyId = id("key_");
    const prefix = tokenValue.slice(0, 18);
    await this.store.saveApiKey({
      keyId,
      projectId,
      prefix,
      digest: digest(tokenValue),
      at: this.now(),
    });
    return { keyId, apiKey: tokenValue, prefix };
  }

  async authenticate(tokenValue: string | undefined): Promise<ApiKeyRecord> {
    if (
      tokenValue === undefined ||
      !/^cov_test_[A-Za-z0-9_-]{8,}$/u.test(tokenValue)
    )
      throw new Error("UNAUTHORIZED");
    const candidates = await this.store.findApiKeyCandidates(
      tokenValue.slice(0, 18),
    );
    const actual = Buffer.from(digest(tokenValue), "hex");
    for (const candidate of candidates) {
      const expected = Buffer.from(candidate.digest, "hex");
      if (
        expected.length === actual.length &&
        timingSafeEqual(expected, actual)
      ) {
        if (candidate.revokedAt !== null) throw new Error("REVOKED_API_KEY");
        return candidate;
      }
    }
    throw new Error("UNAUTHORIZED");
  }
}
