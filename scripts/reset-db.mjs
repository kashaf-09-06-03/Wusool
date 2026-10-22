// Deletes the local database and uploaded files (.data/). The OCR model cache is kept.
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.env.WUSOOL_DATA_DIR ?? path.join(process.cwd(), ".data"));
for (const entry of ["wusool.db", "wusool.db-wal", "wusool.db-shm", "uploads"]) {
  fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
}
console.log(`Reset local data in ${dir}. Restart the server to recreate an empty database.`);
