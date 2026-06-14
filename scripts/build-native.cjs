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

const platformKey = `${process.platform}-${process.arch}`;
const target = targetMap[platformKey];

if (!target) {
  throw new Error(`Unsupported native build platform: ${platformKey}`);
}

const cargoArgs = [
  "build",
  "--manifest-path",
  join(nativeDir, "Cargo.toml"),
  "--release",
  "--target",
  target.triple,
];

const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
const result = spawnSync(cargoCommand, cargoArgs, {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const artifactPath = join(
  nativeDir,
  "target",
  target.triple,
  "release",
  target.artifact
);
const outputPath = join(nativeDir, target.output);

if (!existsSync(artifactPath)) {
  throw new Error(`Cargo build artifact not found: ${artifactPath}`);
}

const copyNativeBinding = () => {
  try {
    copyFileSync(artifactPath, outputPath);
    console.log(`Native binding written to ${outputPath}`);
    return;
  } catch (error) {
    if (error?.code !== "EBUSY") {
      throw error;
    }

    const fallbackOutputPath = join(
      nativeDir,
      `snow_native.${target.platformName}.${Date.now()}.node`
    );
    copyFileSync(artifactPath, fallbackOutputPath);
    console.warn(
      `Native binding target is busy, wrote fresh binding to ${fallbackOutputPath}`
    );
  }
};

copyNativeBinding();
