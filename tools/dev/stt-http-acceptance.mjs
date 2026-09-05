#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { boundedResponseBody } from "./runtime-workspace-acceptance.mjs";

export const fixtureDigest =
  "56a17fd3675e5913e912c404a203bc1062daf3c3c1ec79d5210d20fe28539e8e";
const fixtureSize = 46364;
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const confirmation = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_INSTALLATION";

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function matchesRussianFixture(value) {
  return (
    typeof value === "string" &&
    value
      .trim()
      .replace(/\p{P}+$/gu, "")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase() === "раз два три четыре пять"
  );
}

export function exactOrigin(value) {
  const url = new URL(value);
  requireValue(
    url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !/prod(?:uction)?/i.test(url.hostname),
    "STT acceptance origin is invalid",
  );
  return url.origin;
}

export function sessionHeaders(storage, origin, now = Date.now()) {
  requireValue(
    Array.isArray(storage?.cookies),
    "STT acceptance cookies are absent",
  );
  const hostname = new URL(origin).hostname;
  const selected = ["__Host-kodex-session", "__Host-kodex-csrf"].map((name) => {
    const candidates = storage.cookies.filter(
      (cookie) => cookie?.name === name,
    );
    requireValue(candidates.length === 1, "STT acceptance cookie is ambiguous");
    const cookie = candidates[0];
    requireValue(
      cookie.domain === hostname &&
        cookie.path === "/" &&
        cookie.secure === true &&
        cookie.httpOnly === (name === "__Host-kodex-session") &&
        cookie.partitionKey === undefined &&
        Number.isFinite(cookie.expires) &&
        (cookie.expires === -1 || cookie.expires * 1000 > now) &&
        typeof cookie.value === "string" &&
        (name === "__Host-kodex-session"
          ? /^v1\.[A-Za-z0-9_-]+$/.test(cookie.value)
          : /^[A-Za-z0-9_-]{43}$/.test(cookie.value)) &&
        cookie.value.length >= 43 &&
        cookie.value.length <= (name === "__Host-kodex-session" ? 4096 : 43),
      "STT acceptance cookie boundary is invalid",
    );
    return cookie;
  });
  return {
    Accept: "application/json",
    Origin: origin,
    Cookie: selected
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; "),
    "X-CSRF-Token": selected[1].value,
  };
}

// Bootstrap reader PWA намеренно запрещает API cookies; здесь нужен
// отдельный authenticated snapshot, созданный writeAuthenticatedStorageState.
export function readAuthenticatedState(path) {
  requireValue(
    isAbsolute(path) && realpathSync(dirname(path)) === dirname(path),
    "STT acceptance storage path is invalid",
  );
  const directory = openSync(
    dirname(path),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const parent = fstatSync(directory);
    requireValue(
      parent.isDirectory() &&
        parent.uid === process.getuid() &&
        (parent.mode & 0o777) === 0o700,
      "STT acceptance storage directory is not private",
    );
    const input = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = fstatSync(input);
      requireValue(
        info.isFile() &&
          info.nlink === 1 &&
          info.uid === process.getuid() &&
          (info.mode & 0o077) === 0 &&
          info.size > 0 &&
          info.size <= 1048576,
        "STT acceptance storage file is invalid",
      );
      const buffer = Buffer.alloc(1048577);
      try {
        let size = 0;
        while (size < buffer.length) {
          const count = readSync(
            input,
            buffer,
            size,
            buffer.length - size,
            null,
          );
          if (count === 0) break;
          size += count;
        }
        requireValue(size === info.size, "STT acceptance storage size changed");
        return JSON.parse(buffer.subarray(0, size).toString("utf8"));
      } finally {
        buffer.fill(0);
      }
    } finally {
      closeSync(input);
    }
  } finally {
    closeSync(directory);
  }
}

function configurationPin(value) {
  requireValue(
    value?.ready === true &&
      value.enabled === true &&
      value.permissionKey === "platform.stt.use" &&
      Number.isSafeInteger(value.revision) &&
      value.revision > 0 &&
      /^[a-f0-9]{64}$/.test(value.digest) &&
      typeof value.model === "string" &&
      /^[a-z0-9][a-z0-9._-]{0,159}$/.test(value.model) &&
      Number.isSafeInteger(value.providerCredentialGeneration) &&
      value.providerCredentialGeneration > 0 &&
      Number.isSafeInteger(value.maximumAudioBytes) &&
      value.maximumAudioBytes >= fixtureSize &&
      Array.isArray(value.readinessBlockers) &&
      value.readinessBlockers.length === 0,
    "STT acceptance configuration is not ready",
  );
  return {
    revision: value.revision,
    digest: value.digest,
    model: value.model,
    credentialGeneration: value.providerCredentialGeneration,
  };
}

// Один вызов означает один возможный платный POST. Ошибка не запускает retry.
export async function runSTTHTTPAcceptance({
  origin,
  storage,
  audio,
  projectRef = "",
  fetchAPI = fetch,
  signal = AbortSignal.timeout(120000),
  beforePost = () => {},
}) {
  origin = exactOrigin(origin);
  requireValue(
    Buffer.isBuffer(audio) &&
      audio.length === fixtureSize &&
      createHash("sha256").update(audio).digest("hex") === fixtureDigest,
    "STT acceptance fixture is invalid",
  );
  requireValue(
    !projectRef || /^prj_[A-Za-z0-9_-]{1,96}$/.test(projectRef),
    "STT acceptance project is invalid",
  );
  const headers = sessionHeaders(storage, origin);
  async function request(path, body) {
    const response = await fetchAPI(new URL(path, origin), {
      method: body ? "POST" : "GET",
      headers: body
        ? { ...headers, "X-Audio-Size": String(fixtureSize) }
        : headers,
      body,
      signal,
      redirect: "error",
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw new Error("STT acceptance HTTP status is invalid");
    }
    const validPolicy =
      response.headers.get("content-type")?.split(";")[0].trim() ===
        "application/json" &&
      response.headers
        .get("cache-control")
        ?.split(",")
        .some((part) => part.trim() === "no-store");
    if (!validPolicy) {
      await response.body?.cancel().catch(() => {});
      throw new Error("STT acceptance response policy is invalid");
    }
    return JSON.parse(
      (await boundedResponseBody(response, body ? 65536 : 1048576)).toString(
        "utf8",
      ),
    );
  }
  const before = configurationPin(
    await request("/api/v1/system-stt-configuration"),
  );
  const availability = (await request("/api/v1/bootstrap")).speechTranscription;
  requireValue(
    availability?.available === true &&
      availability.reason === "READY" &&
      typeof availability.validUntil === "string" &&
      Date.parse(availability.validUntil) > Date.now(),
    "STT acceptance user eligibility is unavailable",
  );
  const form = new FormData();
  form.set("audio", new Blob([audio], { type: "audio/mpeg" }), "fixture.mp3");
  beforePost();
  const value = await request(
    projectRef
      ? `/api/v1/projects/${projectRef}/speech/transcriptions`
      : "/api/v1/speech/transcriptions",
    form,
  );
  const receipt = value.receipt;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  requireValue(
    receipt?.completedStage === "PROVIDER_COMPLETED" &&
      Number.isSafeInteger(receipt.authoritySourceRevision) &&
      receipt.authoritySourceRevision > 0 &&
      receipt.configRevision === before.revision &&
      receipt.model === before.model &&
      typeof receipt.requestId === "string" &&
      uuid.test(receipt.requestId) &&
      typeof receipt.correlationId === "string" &&
      uuid.test(receipt.correlationId) &&
      typeof receipt.language === "string" &&
      /^([a-z]{2})?$/.test(receipt.language),
    "STT acceptance receipt is invalid",
  );
  requireValue(
    matchesRussianFixture(value.text),
    "STT acceptance transcript mismatch",
  );
  const after = configurationPin(
    await request("/api/v1/system-stt-configuration"),
  );
  requireValue(
    JSON.stringify(before) === JSON.stringify(after),
    "STT acceptance configuration changed",
  );
  return {
    status: "PASS",
    fixtureDigest,
    match: true,
    scope: projectRef ? "PROJECT" : "ORGANIZATION",
    configurationRevision: before.revision,
    configurationDigest: before.digest,
    authoritySourceRevision: receipt.authoritySourceRevision,
    requestId: receipt.requestId,
    correlationId: receipt.correlationId,
  };
}

async function main() {
  // Значения env и содержимое ошибок внешних библиотек никогда не печатаются.
  const args = process.argv.slice(2);
  const expectedSHA = args[1];
  requireValue(
    args[0] === "--expected-sha" &&
      /^[a-f0-9]{40}$/.test(expectedSHA) &&
      (args.length === 2 || (args.length === 4 && args[2] === "--project-ref")),
    "STT acceptance arguments are invalid",
  );
  requireValue(
    process.env.KODEX_E2E_CONFIRM_DISPOSABLE === confirmation &&
      process.env.KODEX_PROVIDER_E2E_API_KEY === "1",
    "STT acceptance requires disposable and provider opt-in",
  );
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  requireValue(
    git(["rev-parse", "HEAD"]) === expectedSHA &&
      git(["status", "--porcelain", "--untracked-files=all"]) === "",
    "STT acceptance source is not exact and clean",
  );
  const origin = exactOrigin(process.env.KODEX_E2E_BASE_URL);
  const stateDirectory = process.env.KODEX_E2E_STATE_DIRECTORY ?? "";
  const storagePath = process.env.KODEX_E2E_STORAGE_STATE ?? "";
  const prefix = process.env.KODEX_E2E_RESOURCE_PREFIX ?? "";
  requireValue(
    isAbsolute(stateDirectory) &&
      realpathSync(stateDirectory) === stateDirectory &&
      isAbsolute(storagePath) &&
      dirname(storagePath) === stateDirectory &&
      /^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$/.test(prefix),
    "STT acceptance private paths are invalid",
  );
  const storage = readAuthenticatedState(storagePath);
  const audio = readFileSync(
    resolve(
      repositoryRoot,
      "services/internal/stt-tts-service/testdata/1-2-3-4-5.mp3",
    ),
  );
  const outputPath = resolve(stateDirectory, `${prefix}-stt-http.json`);
  // Durable reservation блокирует повтор того же сценария после UNKNOWN/crash.
  const output = openSync(
    outputPath,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let attempted = false;
  const save = (result) => {
    ftruncateSync(output, 0);
    const payload =
      JSON.stringify({
        version: 1,
        sourceSHA: expectedSHA,
        fixtureDigest,
        attempted,
        ...result,
      }) + "\n";
    requireValue(
      writeSync(output, payload, 0, "utf8") === Buffer.byteLength(payload),
      "STT acceptance evidence write is incomplete",
    );
    fsyncSync(output);
  };
  try {
    const info = fstatSync(output);
    requireValue(
      info.isFile() &&
        info.nlink === 1 &&
        info.uid === process.getuid() &&
        (info.mode & 0o077) === 0,
      "STT acceptance evidence file is invalid",
    );
    save({ status: "NOT RUN", stage: "PREFLIGHT" });
    const directory = openSync(
      stateDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    const result = await runSTTHTTPAcceptance({
      origin,
      storage,
      audio,
      projectRef: args[3] ?? "",
      beforePost: () => {
        attempted = true;
        save({ status: "NOT RUN", stage: "PROVIDER_ATTEMPT" });
      },
    });
    save(result);
    process.stdout.write(
      `STT HTTP acceptance PASS fixture=${fixtureDigest} match=true\n`,
    );
  } catch {
    save({
      status: "FAIL",
      stage: attempted ? "PROVIDER_ATTEMPT" : "PREFLIGHT",
    });
    throw new Error("STT acceptance failed");
  } finally {
    audio.fill(0);
    closeSync(output);
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch {
    process.stderr.write(
      "STT HTTP acceptance FAIL; no automatic retry was performed\n",
    );
    process.exitCode = 1;
  }
}
