const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const HMM_PATH = "./libs/hmm/hmm";
const OUTPUT_DIR = "./output";

async function convertTilesToMesh(tileDir) {
  // Read metadata
  const metadataPath = path.join(tileDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    console.error(`No metadata.json found in ${tileDir}`);
    return;
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  console.log(`Processing: ${tileDir}`);
  console.log(`  Resolution: ${metadata.resolution.x.toFixed(2)}m x ${metadata.resolution.y.toFixed(2)}m per pixel`);
  console.log(`  Value range: ${metadata.valueRange.min} to ${metadata.valueRange.max}`);

  // Calculate z scale
  // z scale = elevation range / pixel size (in same units)
  const elevationRange = metadata.valueRange.max - metadata.valueRange.min;
  const avgPixelSize = (metadata.resolution.x + metadata.resolution.y) / 2;
  const zScale = elevationRange / avgPixelSize;

  console.log(`  Elevation range: ${elevationRange}m`);
  console.log(`  Avg pixel size: ${avgPixelSize.toFixed(2)}m`);
  console.log(`  Z scale: ${zScale.toFixed(4)}`);

  // Create meshes and normals directories
  const meshDir = path.join(tileDir, "meshes");
  const normalsDir = path.join(tileDir, "normals");
  if (!fs.existsSync(meshDir)) {
    fs.mkdirSync(meshDir, { recursive: true });
  }
  if (!fs.existsSync(normalsDir)) {
    fs.mkdirSync(normalsDir, { recursive: true });
  }

  // Find all tile PNGs
  const tiles = fs.readdirSync(tileDir)
    .filter(f => f.startsWith("tile_") && f.endsWith(".png"));

  console.log(`  Found ${tiles.length} tiles`);

  for (const tile of tiles) {
    const tilePath = path.join(tileDir, tile);
    const stlPath = path.join(meshDir, tile.replace(".png", ".stl"));
    const normalPath = path.join(normalsDir, tile.replace(".png", "_normal.png"));

    console.log(`  Converting: ${tile} -> ${path.basename(stlPath)}, ${path.basename(normalPath)}`);

    try {
      // Run hmm with appropriate settings
      // -z: z scale
      // -e: max error (0.001 = 0.1% of height range)
      // --normal-map: output normal map PNG
      const cmd = `${HMM_PATH} -z ${zScale.toFixed(4)} -e 0.001 --normal-map "${normalPath}" "${tilePath}" "${stlPath}"`;
      execSync(cmd, { stdio: "pipe" });
    } catch (err) {
      console.error(`    Error: ${err.message}`);
    }
  }

  console.log(`  Meshes saved to: ${meshDir}`);
  console.log(`  Normal maps saved to: ${normalsDir}`);
}

async function main() {
  // Check if hmm exists
  if (!fs.existsSync(HMM_PATH)) {
    console.error(`hmm not found at ${HMM_PATH}. Run 'make' in libs/hmm first.`);
    process.exit(1);
  }

  // Find all tile size directories
  const tileSizeDirs = fs.readdirSync(OUTPUT_DIR)
    .filter(f => /^\d+$/.test(f))
    .map(f => path.join(OUTPUT_DIR, f));

  for (const tileSizeDir of tileSizeDirs) {
    // Find all geotiff output directories
    const geotiffDirs = fs.readdirSync(tileSizeDir)
      .filter(f => fs.statSync(path.join(tileSizeDir, f)).isDirectory())
      .map(f => path.join(tileSizeDir, f));

    for (const geotiffDir of geotiffDirs) {
      await convertTilesToMesh(geotiffDir);
    }
  }

  console.log("Done!");
}

main().catch(console.error);
