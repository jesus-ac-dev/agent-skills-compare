import fs from "fs";

export async function getContext() {
  const hasPackageJson = fs.existsSync("package.json");
  let pkg = {};

  if (hasPackageJson) {
    pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  }

  return {
    project_name: pkg.name || "unknown",
    language: "javascript",
    test_framework: pkg.devDependencies?.vitest
      ? "vitest"
      : pkg.devDependencies?.jest
      ? "jest"
      : "unknown"
  };
}
