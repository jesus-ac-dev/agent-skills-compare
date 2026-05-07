import fs from "fs/promises";
import path from "path";

const ROOT = process.cwd();

export async function writeFile(filePath, content) {
  const safePath = path.join(ROOT, filePath);

  try {
    await fs.writeFile(safePath, content, "utf8");
    return { status: "ok" };
  } catch (err) {
    return { error: `Erro ao escrever ficheiro: ${filePath}`, details: err.message };
  }
}
