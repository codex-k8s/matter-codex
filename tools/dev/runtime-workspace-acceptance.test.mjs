import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  boundedResponseBody,
  verifyWorkspaceAcceptance,
  workspaceProbeSource,
} from "./runtime-workspace-acceptance.mjs";

const nonce = "a".repeat(32);
const hash = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const checks = Object.fromEntries(
    [
      "create",
      "read",
      "atomicReplace",
      "readReplacement",
      "delete",
      "input",
      "source",
      "context",
      "skills",
      "memory",
      "credential",
      "symlink",
      "traversal",
      "outside",
    ].map((key) => [key, true]),
  );
  const result = Buffer.from(`mvp-workspace:${nonce}:replacement\n`);
  const proof = {
    schema: "kodex.workspace-acceptance.v1",
    nonce,
    uid: 10002,
    checks,
    resultSHA256: hash(result),
  };
  const provenance = {
    schema: "kodex.workspace-write-result.v1",
    runtime_revision_ref: "rrev_fixture",
    runtime_revision_version: 3,
    runtime_revision_digest: "b".repeat(64),
    attempt: 2,
    execution_binding_digest: "c".repeat(64),
  };
  const run = {
    ref: "run_fixture",
    projectRef: "prj_fixture",
    sessionRef: "ses_fixture",
    target: { ref: "agt_fixture" },
    state: "SUCCEEDED",
    attempt: 2,
    lastEventSequence: 1,
    artifactRefs: ["art_result", "art_proof", "art_provenance"],
  };
  const revision = {
    ref: provenance.runtime_revision_ref,
    version: 3,
    revisionDigest: provenance.runtime_revision_digest,
    runRef: run.ref,
    sessionRef: run.sessionRef,
    attempt: 2,
  };
  const contents = {
    art_result: result,
    art_proof: Buffer.from(JSON.stringify(proof)),
    art_provenance: Buffer.from(JSON.stringify(provenance)),
  };
  const artifacts = Object.fromEntries(
    Object.entries(contents).map(([ref, bytes], index) => [
      ref,
      {
        ref,
        runRef: run.ref,
        projectRef: run.projectRef,
        sessionRef: run.sessionRef,
        source: "AGENT_RESULT",
        lifecycleState: "ACTIVE",
        scanState: "CLEAN",
        fileName: [
          "mvp-workspace-result.txt",
          "mvp-workspace-proof.json",
          "workspace-write-result.json",
        ][index],
        sizeBytes: bytes.length,
        digest: `sha256:${hash(bytes)}`,
      },
    ]),
  );
  const events = {
    items: [
      {
        runRef: run.ref,
        sequence: 1,
        type: "TOOL_CALL_RECORDED",
        toolCall: {
          tool: "CODEX_SHELL",
          state: "SUCCEEDED",
          safeParameters: {
            source: "AGENT",
            cwd_scope: "WORKSPACE",
            exit_code: "ZERO",
          },
        },
      },
    ],
    complete: true,
    currentSequence: 1,
  };
  function replace(ref, value) {
    contents[ref] = Buffer.from(JSON.stringify(value));
    artifacts[ref].sizeBytes = contents[ref].length;
    artifacts[ref].digest = `sha256:${hash(contents[ref])}`;
  }
  return {
    run,
    revision,
    artifacts,
    contents,
    proof,
    provenance,
    events,
    replace,
    parameters: {
      runRef: run.ref,
      projectRef: run.projectRef,
      agentRef: run.target.ref,
      nonce,
      getJSON: async (path) => {
        if (path.includes("/artifacts/"))
          return artifacts[path.split("/").at(-1)];
        if (path.endsWith("/runtime-revision-diff"))
          return { current: revision };
        if (path.includes("/events?")) return events;
        return run;
      },
      getContent: async (path) => contents[path.split("/").at(-2)],
    },
  };
}

test("Сопоставляет настоящий результат, owner metadata, tool event и runtime attempt", async () => {
  const data = fixture();
  const evidence = await verifyWorkspaceAcceptance(data.parameters);
  assert.equal(evidence.attempt, 2);
  assert.equal(evidence.checks.nativeAgentShell, "PASS");
  assert.equal(evidence.checks.atomicReplace, "PASS");
  assert.equal(evidence.artifacts.length, 3);
  assert.equal(evidence.quota, "NOT RUN");
  assert.ok(!JSON.stringify(evidence).includes(nonce));
});

for (const [name, mutate] of Object.entries({
  "чужой проект": (f) => {
    f.run.projectRef = "prj_foreign";
  },
  "чужой агент": (f) => {
    f.run.target.ref = "agt_foreign";
  },
  "неуспешный запуск": (f) => {
    f.run.state = "FAILED";
  },
  "нет native shell": (f) => {
    f.events.items[0].toolCall.tool = "CODEX_SLEEP";
  },
  "чужой event": (f) => {
    f.events.items[0].runRef = "run_foreign";
  },
  "повтор sequence": (f) => {
    f.events.items[0].sequence = 0;
  },
  "неполный catch-up": (f) => {
    f.run.lastEventSequence = 1000;
  },
  "нет persisted artifact": (f) => {
    f.run.artifactRefs.pop();
  },
  "чужой artifact": (f) => {
    f.artifacts.art_proof.runRef = "run_foreign";
  },
  "не агентский source": (f) => {
    f.artifacts.art_proof.source = "CONTROL_CENTER";
  },
  карантин: (f) => {
    f.artifacts.art_proof.scanState = "QUARANTINED";
  },
  "чужой artifact с pending scan": (f) => {
    f.artifacts.art_proof.runRef = "run_foreign";
    f.artifacts.art_proof.scanState = "SCANNING";
  },
  "неверный hash": (f) => {
    f.contents.art_result = Buffer.from("wrong");
  },
  "другая проверка": (f) => {
    f.proof.nonce = "d".repeat(32);
    f.replace("art_proof", f.proof);
  },
  "root процесс": (f) => {
    f.proof.uid = 0;
    f.replace("art_proof", f.proof);
  },
  "пропущенный read": (f) => {
    delete f.proof.checks.read;
    f.replace("art_proof", f.proof);
  },
  "иная attempt": (f) => {
    f.provenance.attempt = 1;
    f.replace("art_provenance", f.provenance);
  },
  "иная revision": (f) => {
    f.revision.ref = "rrev_foreign";
  },
}))
  test(`Отклоняет ${name}`, async () => {
    const data = fixture();
    mutate(data);
    await assert.rejects(
      verifyWorkspaceAcceptance(data.parameters),
      /Runtime workspace acceptance failed/,
    );
  });

test("Незавершённый scan имеет отдельный bounded retry outcome", async () => {
  const data = fixture();
  data.artifacts.art_proof.scanState = "SCANNING";
  await assert.rejects(verifyWorkspaceAcceptance(data.parameters), {
    code: "ARTIFACT_SCAN_PENDING",
  });
});

test("Читает тело с лимитом до полной буферизации и отменяет oversized stream", async () => {
  assert.equal(
    (await boundedResponseBody(new Response("abcd"), 4)).toString(),
    "abcd",
  );
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    boundedResponseBody(new Response(body), 4),
    /response size exceeds limit/,
  );
  assert.equal(cancelled, true);
  await assert.rejects(
    boundedResponseBody(
      new Response("x", { headers: { "content-length": "100" } }),
      4,
    ),
  );
});

test("Точный выдаваемый модели probe выполняет CRUD и отказы в non-root disposable mount", () => {
  assert.ok(process.getuid() > 0, "non-root test process is required");
  const root = mkdtempSync(join(tmpdir(), "kodex-workspace-probe-"));
  try {
    for (const path of [
      "input",
      "knowledge",
      "context/skills",
      "context/memory",
      ".kodex/state/codex-home",
      ".kodex/outbox",
    ])
      mkdirSync(join(root, path), { recursive: true, mode: 0o700 });
    const credential = join(root, ".kodex/state/codex-home/auth.json");
    writeFileSync(credential, "synthetic-fixture", { mode: 0o600 });
    const args = [
      "--unshare-user",
      "--uid",
      String(process.getuid()),
      "--gid",
      String(process.getgid()),
      "--tmpfs",
      "/",
      "--ro-bind",
      "/usr",
      "/usr",
      "--ro-bind",
      "/lib",
      "/lib",
      "--ro-bind",
      "/lib64",
      "/lib64",
      "--ro-bind",
      process.execPath,
      "/node",
      "--bind",
      root,
      "/workspace",
      ...["input", "knowledge", "context"].flatMap((path) => [
        "--ro-bind",
        join(root, path),
        `/workspace/${path}`,
      ]),
      "--ro-bind",
      credential,
      "/workspace/.kodex/state/codex-home/auth.json",
      "--chdir",
      "/workspace",
      "--remount-ro",
      "/",
      "/node",
      "--input-type=module",
      "--eval",
      workspaceProbeSource(nonce),
    ];
    const result = spawnSync("bwrap", args, {
      env: { PATH: "/usr/bin:/bin", LANG: "C" },
      timeout: 10_000,
      maxBuffer: 8192,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(
      readFileSync(
        join(root, ".kodex/outbox/mvp-workspace-proof.json"),
        "utf8",
      ),
    );
    assert.equal(Object.keys(proof.checks).length, 14);
    assert.ok(Object.values(proof.checks).every((value) => value === true));
    assert.equal(readFileSync(credential, "utf8"), "synthetic-fixture");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
