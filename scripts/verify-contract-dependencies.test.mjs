import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const verifier = fileURLToPath(
  new URL("./verify-contract-dependencies.mjs", import.meta.url),
);
const installer = fileURLToPath(
  new URL("./install-contract-dependencies.mjs", import.meta.url),
);

function git(cwd, arguments_) {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "covenant-dependency-test-"));
  const dependency = join(root, "lib", "example");
  mkdirSync(dependency, { recursive: true });
  git(dependency, ["init"]);
  git(dependency, ["config", "user.email", "fixture@covenant.invalid"]);
  git(dependency, ["config", "user.name", "Covenant Fixture"]);
  writeFileSync(join(dependency, "Fixture.sol"), "contract Fixture {}\n");
  writeFileSync(join(dependency, "README.md"), "fixture\n");
  writeFileSync(
    join(dependency, ".gitignore"),
    "Ignored.sol\nignored-foundry.toml\n",
  );
  git(dependency, ["add", "."]);
  git(dependency, ["commit", "-m", "fixture"]);
  const commit = git(dependency, ["rev-parse", "HEAD"]);
  const repository = "https://github.com/example/example.git";
  git(dependency, ["remote", "add", "origin", repository]);
  const manifest = join(root, "dependencies.json");
  writeFileSync(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      dependencies: [
        {
          name: "example",
          repository,
          version: "v1.0.0",
          commit,
          directory: "lib/example",
        },
      ],
    }),
  );
  return { root, dependency, manifest, commit };
}

function verify(value) {
  return spawnSync(
    process.execPath,
    [verifier, "--root", value.root, "--manifest", value.manifest],
    { encoding: "utf8" },
  );
}

function install(value) {
  return spawnSync(
    process.execPath,
    [installer, "--root", value.root, "--manifest", value.manifest],
    { encoding: "utf8" },
  );
}

test("dependency verification accepts an exact clean checkout", () => {
  const value = fixture();
  assert.equal(verify(value).status, 0);
});

test("installer accepts an existing exact clean checkout", () => {
  const value = fixture();
  assert.equal(install(value).status, 0);
});

test("installer refuses an existing dirty checkout", () => {
  const value = fixture();
  writeFileSync(join(value.dependency, "Fixture.sol"), "contract Dirty {}\n");
  assert.notEqual(install(value).status, 0);
});

test("installer refuses a hidden-dirty checkout", () => {
  const value = fixture();
  git(value.dependency, ["update-index", "--assume-unchanged", "Fixture.sol"]);
  try {
    writeFileSync(
      join(value.dependency, "Fixture.sol"),
      "contract Hidden {}\n",
    );
    assert.equal(git(value.dependency, ["status", "--porcelain"]), "");
    const result = install(value);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Fixture\.sol.*assume-unchanged/);
  } finally {
    git(value.dependency, [
      "update-index",
      "--no-assume-unchanged",
      "Fixture.sol",
    ]);
  }
});

const mutations = [
  [
    "wrong HEAD commit",
    (v) => {
      writeFileSync(join(v.dependency, "README.md"), "second\n");
      git(v.dependency, ["add", "."]);
      git(v.dependency, ["commit", "-m", "second"]);
    },
  ],
  [
    "modified tracked Solidity",
    (v) =>
      writeFileSync(join(v.dependency, "Fixture.sol"), "contract Mutated {}\n"),
  ],
  [
    "deleted tracked Solidity",
    (v) => rmSync(join(v.dependency, "Fixture.sol")),
  ],
  [
    "replaced tracked file",
    (v) => {
      rmSync(join(v.dependency, "Fixture.sol"));
      writeFileSync(
        join(v.dependency, "Fixture.sol"),
        "contract Replacement {}\n",
      );
    },
  ],
  [
    "staged modification",
    (v) => {
      writeFileSync(join(v.dependency, "Fixture.sol"), "contract Staged {}\n");
      git(v.dependency, ["add", "Fixture.sol"]);
    },
  ],
  ["staged deletion", (v) => git(v.dependency, ["rm", "Fixture.sol"])],
  [
    "untracked Solidity",
    (v) =>
      writeFileSync(
        join(v.dependency, "Injected.sol"),
        "contract Injected {}\n",
      ),
  ],
  [
    "untracked Foundry configuration",
    (v) =>
      writeFileSync(join(v.dependency, "foundry.toml"), "[profile.default]\n"),
  ],
  [
    "untracked remappings",
    (v) => writeFileSync(join(v.dependency, "remappings.txt"), "x/=y/\n"),
  ],
  [
    "ignored untracked Solidity",
    (v) =>
      writeFileSync(join(v.dependency, "Ignored.sol"), "contract Ignored {}\n"),
  ],
  [
    "ignored untracked configuration",
    (v) =>
      writeFileSync(
        join(v.dependency, "ignored-foundry.toml"),
        "[profile.default]\n",
      ),
  ],
  [
    "wrong origin URL",
    (v) =>
      git(v.dependency, [
        "remote",
        "set-url",
        "origin",
        "https://github.com/attacker/replaced.git",
      ]),
  ],
];

for (const [name, mutate] of mutations) {
  test(`dependency verification rejects ${name}`, () => {
    const value = fixture();
    mutate(value);
    const result = verify(value);
    assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
    if (name === "ignored untracked Solidity") {
      assert.match(
        result.stderr,
        /ignored untracked path is present: "Ignored\.sol"/,
      );
    }
    if (name === "ignored untracked configuration") {
      assert.match(
        result.stderr,
        /ignored untracked path is present: "ignored-foundry\.toml"/,
      );
    }
  });
}

for (const [name, enableFlag, disableFlag, expectedFlag] of [
  [
    "assume-unchanged tracked mutation",
    "--assume-unchanged",
    "--no-assume-unchanged",
    "assume-unchanged",
  ],
  [
    "skip-worktree tracked mutation",
    "--skip-worktree",
    "--no-skip-worktree",
    "skip-worktree",
  ],
]) {
  test(`dependency verification rejects ${name}`, () => {
    const value = fixture();
    git(value.dependency, ["update-index", enableFlag, "Fixture.sol"]);
    try {
      writeFileSync(
        join(value.dependency, "Fixture.sol"),
        "contract Concealed {}\n",
      );
      assert.equal(
        git(value.dependency, ["status", "--porcelain", "--", "Fixture.sol"]),
        "",
      );
      const result = verify(value);
      assert.notEqual(result.status, 0, `${name} unexpectedly passed`);
      assert.match(result.stderr, new RegExp(`Fixture\\.sol.*${expectedFlag}`));
      assert.match(result.stderr, /Fixture\.sol.*differs from HEAD blob/);
    } finally {
      git(value.dependency, ["update-index", disableFlag, "Fixture.sol"]);
    }
  });
}
