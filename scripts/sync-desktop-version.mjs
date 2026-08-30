import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");

const VERSION_PATTERN = /^(\s*version\s*=\s*)"[^"]+"(\s*)$/m;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Keeps the native package metadata aligned with the root release-please
 * package. Release-please owns the root version only; Tauri reads its version
 * from Cargo and tauri.conf.json when it creates installer names and metadata.
 */
export async function syncDesktopVersion(rootDirectory = repositoryRoot) {
  const rootPackagePath = path.join(rootDirectory, "package.json");
  const cargoPath = path.join(
    rootDirectory,
    "apps",
    "desktop",
    "src-tauri",
    "Cargo.toml",
  );
  const tauriConfigPath = path.join(
    rootDirectory,
    "apps",
    "desktop",
    "src-tauri",
    "tauri.conf.json",
  );

  const rootPackage = JSON.parse(await readFile(rootPackagePath, "utf8"));
  const version = rootPackage.version;
  if (typeof version !== "string" || !SEMVER_PATTERN.test(version)) {
    throw new Error(
      `Root package.json must contain a valid release version; received ${String(version)}`,
    );
  }

  const cargo = await readFile(cargoPath, "utf8");
  if (!VERSION_PATTERN.test(cargo)) {
    throw new Error(`Could not find the package version in ${cargoPath}`);
  }
  const nextCargo = cargo.replace(
    VERSION_PATTERN,
    (_, prefix, suffix) => `${prefix}"${version}"${suffix}`,
  );
  if (nextCargo !== cargo) {
    await writeFile(cargoPath, nextCargo);
  }

  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  tauriConfig.version = version;
  await writeFile(
    tauriConfigPath,
    `${JSON.stringify(tauriConfig, null, 2)}\n`,
  );

  return version;
}

if (path.resolve(process.argv[1] ?? "") === path.resolve(scriptPath)) {
  const version = await syncDesktopVersion();
  console.log(`Synchronized desktop version to ${version}`);
}
