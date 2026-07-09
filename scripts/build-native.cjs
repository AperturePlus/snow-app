const { copyFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = join(__dirname, "..");
const nativeDir = join(projectRoot, "native");

const targetMap = {
  "win32-x64": {
    triple: "x86_64-pc-windows-msvc",
    artifact: "snow_native.dll",
    output: "snow_native.win32-x64-msvc.node",
    platformName: "win32-x64-msvc",
  },
  "win32-arm64": {
    triple: "aarch64-pc-windows-msvc",
    artifact: "snow_native.dll",
    output: "snow_native.win32-arm64-msvc.node",
    platformName: "win32-arm64-msvc",
  },
  "darwin-x64": {
    triple: "x86_64-apple-darwin",
    artifact: "libsnow_native.dylib",
    output: "snow_native.darwin-x64.node",
    platformName: "darwin-x64",
  },
  "darwin-arm64": {
    triple: "aarch64-apple-darwin",
    artifact: "libsnow_native.dylib",
    output: "snow_native.darwin-arm64.node",
    platformName: "darwin-arm64",
  },
  "linux-x64": {
    triple: "x86_64-unknown-linux-gnu",
    artifact: "libsnow_native.so",
    output: "snow_native.linux-x64-gnu.node",
    platformName: "linux-x64-gnu",
  },
  "linux-arm64": {
    triple: "aarch64-unknown-linux-gnu",
    artifact: "libsnow_native.so",
    output: "snow_native.linux-arm64-gnu.node",
    platformName: "linux-arm64-gnu",
  },
};

// macOS: build a universal (arm64 + x64) binary via lipo
const darwinTargets = [
  targetMap["darwin-arm64"],
  targetMap["darwin-x64"],
];
const darwinUniversalOutput = "snow_native.darwin-universal.node";

const platformKey = `${process.platform}-${process.arch}`;
const target = targetMap[platformKey];

if (!target) {
  throw new Error(`Unsupported native build platform: ${platformKey}`);
}

const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";

function runCargoBuild(triple) {
  const cargoArgs = [
    "build",
    "--manifest-path",
    join(nativeDir, "Cargo.toml"),
    "--release",
    "--target",
    triple,
  ];

  const result = spawnSync(cargoCommand, cargoArgs, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function getArtifactPath(t) {
  return join(nativeDir, "target", t.triple, "release", t.artifact);
}

function copyNativeBinding(artifactPath, outputPath, platformName) {
  try {
    copyFileSync(artifactPath, outputPath);
    console.log(`Native binding written to ${outputPath}`);
  } catch (error) {
    if (error?.code !== "EBUSY") {
      throw error;
    }

    const fallbackOutputPath = join(
      nativeDir,
      `snow_native.${platformName}.${Date.now()}.node`
    );
    copyFileSync(artifactPath, fallbackOutputPath);
    console.warn(
      `Native binding target is busy, wrote fresh binding to ${fallbackOutputPath}`
    );
  }
}

if (process.platform === "darwin") {
  // Build both arm64 and x64, then merge with lipo into a universal binary
  for (const t of darwinTargets) {
    console.log(`Building Rust native for ${t.triple}...`);
    runCargoBuild(t.triple);
  }

  const arm64Artifact = getArtifactPath(darwinTargets[0]);
  const x64Artifact = getArtifactPath(darwinTargets[1]);

  if (!existsSync(arm64Artifact)) {
    throw new Error(`Cargo build artifact not found: ${arm64Artifact}`);
  }
  if (!existsSync(x64Artifact)) {
    throw new Error(`Cargo build artifact not found: ${x64Artifact}`);
  }

  const universalOutputPath = join(nativeDir, darwinUniversalOutput);

  // Merge into a universal binary using lipo
  const lipoResult = spawnSync("lipo", [
    "-create",
    arm64Artifact,
    x64Artifact,
    "-output",
    universalOutputPath,
  ], {
    stdio: "inherit",
  });

  if (lipoResult.status !== 0) {
    throw new Error("lipo failed to create universal binary");
  }

  console.log(`Universal native binding written to ${universalOutputPath}`);
} else {
  // Non-macOS: build single architecture as before
  runCargoBuild(target.triple);

  const artifactPath = getArtifactPath(target);
  const outputPath = join(nativeDir, target.output);

  if (!existsSync(artifactPath)) {
    throw new Error(`Cargo build artifact not found: ${artifactPath}`);
  }

  copyNativeBinding(artifactPath, outputPath, target.platformName);
}
