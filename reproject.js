const GeoTIFF = require("geotiff");
const proj4 = require("proj4");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// Define projections
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");
proj4.defs(
  "EPSG:32615",
  "+proj=utm +zone=15 +datum=WGS84 +units=m +no_defs",
);

const SOURCE_DIR = "./source";
const OUTPUT_DIR = "./output";
const TILE_SIZE = 1024;

async function processGeoTiff(inputPath) {
  console.log(`Processing: ${inputPath}`);

  const tiff = await GeoTIFF.fromFile(inputPath);
  const image = await tiff.getImage();

  // Get image dimensions and geo info
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();
  const [minX, minY, maxX, maxY] = bbox;

  console.log(`Original dimensions: ${width}x${height}`);
  console.log(`Original bounds: [${minX}, ${minY}, ${maxX}, ${maxY}]`);
  console.log(`Bit depth: ${image.getBitsPerSample()} bits per sample`);
  console.log(`Sample format: ${image.getSampleFormat()}`);
  console.log(`Samples per pixel: ${image.getSamplesPerPixel()}`);

  // Read raster data
  const rasterData = await image.readRasters();
  const data = rasterData[0]; // First band

  // Get source projection from GeoTIFF metadata
  const geoKeys = image.getGeoKeys();
  console.log("GeoKeys:", geoKeys);

  // Assuming source is EPSG:4326 (common for DEM data like SRTM)
  const srcProj = "EPSG:4326";
  const dstProj = "EPSG:32615";

  // Transform corner coordinates to UTM 15N
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];

  const transformedCorners = corners.map((c) => proj4(srcProj, dstProj, c));
  console.log("Transformed corners (UTM 15N):", transformedCorners);

  // Calculate new bounds in UTM
  const utmMinX = Math.min(...transformedCorners.map((c) => c[0]));
  const utmMaxX = Math.max(...transformedCorners.map((c) => c[0]));
  const utmMinY = Math.min(...transformedCorners.map((c) => c[1]));
  const utmMaxY = Math.max(...transformedCorners.map((c) => c[1]));

  console.log(`UTM bounds: [${utmMinX}, ${utmMinY}, ${utmMaxX}, ${utmMaxY}]`);

  // Calculate resolution in UTM coordinates
  const srcResX = (maxX - minX) / width;
  const srcResY = (maxY - minY) / height;

  // Approximate UTM resolution (meters per pixel)
  const utmResX = (utmMaxX - utmMinX) / width;
  const utmResY = (utmMaxY - utmMinY) / height;

  console.log(
    `UTM resolution: ${utmResX.toFixed(2)}m x ${utmResY.toFixed(2)}m per pixel`,
  );

  // Create output directory
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputSubDir = path.join(OUTPUT_DIR, String(TILE_SIZE), baseName);
  if (!fs.existsSync(outputSubDir)) {
    fs.mkdirSync(outputSubDir, { recursive: true });
  }

  // Find min/max values for normalization (excluding nodata)
  let minVal = Infinity;
  let maxVal = -Infinity;
  // Default nodata value for SRTM elevation data
  const noDataValue = -32768;

  for (let i = 0; i < data.length; i++) {
    if (data[i] !== noDataValue && !isNaN(data[i])) {
      minVal = Math.min(minVal, data[i]);
      maxVal = Math.max(maxVal, data[i]);
    }
  }

  console.log(`Value range: ${minVal} to ${maxVal}`);

  // Reproject the data
  const newWidth = width;
  const newHeight = height;
  const reprojectedData = new Float32Array(newWidth * newHeight);
  reprojectedData.fill(noDataValue);

  console.log("Reprojecting data...");

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      // Calculate UTM coordinate for this pixel
      const utmX = utmMinX + (x + 0.5) * utmResX;
      const utmY = utmMaxY - (y + 0.5) * utmResY;

      // Transform back to source CRS
      const [srcLon, srcLat] = proj4(dstProj, srcProj, [utmX, utmY]);

      // Calculate source pixel coordinates
      const srcX = (srcLon - minX) / srcResX;
      const srcY = (maxY - srcLat) / srcResY;

      // Bilinear interpolation
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      if (x0 >= 0 && x1 < width && y0 >= 0 && y1 < height) {
        const fx = srcX - x0;
        const fy = srcY - y0;

        const v00 = data[y0 * width + x0];
        const v10 = data[y0 * width + x1];
        const v01 = data[y1 * width + x0];
        const v11 = data[y1 * width + x1];

        if (
          v00 !== noDataValue &&
          v10 !== noDataValue &&
          v01 !== noDataValue &&
          v11 !== noDataValue
        ) {
          const value =
            v00 * (1 - fx) * (1 - fy) +
            v10 * fx * (1 - fy) +
            v01 * (1 - fx) * fy +
            v11 * fx * fy;
          reprojectedData[y * newWidth + x] = value;
        }
      }
    }
  }

  console.log("Creating PNG tiles...");

  // Calculate number of tiles
  const tilesX = Math.ceil(newWidth / TILE_SIZE);
  const tilesY = Math.ceil(newHeight / TILE_SIZE);

  console.log(`Creating ${tilesX}x${tilesY} tiles (${tilesX * tilesY} total)`);

  // Create tiles
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const startX = tx * TILE_SIZE;
      const startY = ty * TILE_SIZE;
      const tileWidth = Math.min(TILE_SIZE, newWidth - startX);
      const tileHeight = Math.min(TILE_SIZE, newHeight - startY);

      // Create 8-bit RGBA buffer for tile
      const tileData = Buffer.alloc(tileWidth * tileHeight * 4);

      for (let y = 0; y < tileHeight; y++) {
        for (let x = 0; x < tileWidth; x++) {
          const srcIdx = (startY + y) * newWidth + (startX + x);
          const dstIdx = (y * tileWidth + x) * 4;

          const value = reprojectedData[srcIdx];

          if (value === noDataValue || isNaN(value)) {
            // Transparent for nodata
            tileData[dstIdx] = 0;
            tileData[dstIdx + 1] = 0;
            tileData[dstIdx + 2] = 0;
            tileData[dstIdx + 3] = 0;
          } else {
            // Normalize to 0-255 (8-bit)
            const normalized = Math.round(
              ((value - minVal) / (maxVal - minVal)) * 255,
            );
            const clamped = Math.max(0, Math.min(255, normalized));

            tileData[dstIdx] = clamped; // R
            tileData[dstIdx + 1] = clamped; // G
            tileData[dstIdx + 2] = clamped; // B
            tileData[dstIdx + 3] = 255; // A
          }
        }
      }

      // Save tile as 8-bit PNG
      const tilePath = path.join(outputSubDir, `tile_${ty}_${tx}.png`);
      await sharp(tileData, {
        raw: {
          width: tileWidth,
          height: tileHeight,
          channels: 4,
        },
      })
        .png()
        .toFile(tilePath);
    }
  }

  // Save metadata
  const metadata = {
    sourceCRS: srcProj,
    targetCRS: dstProj,
    originalBounds: { minX, minY, maxX, maxY },
    utmBounds: { minX: utmMinX, minY: utmMinY, maxX: utmMaxX, maxY: utmMaxY },
    originalDimensions: { width, height },
    reprojectedDimensions: { width: newWidth, height: newHeight },
    tileSize: TILE_SIZE,
    tileGrid: { columns: tilesX, rows: tilesY },
    valueRange: { min: minVal, max: maxVal },
    resolution: { x: utmResX, y: utmResY, unit: "meters" },
  };

  fs.writeFileSync(
    path.join(outputSubDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
  );

  console.log(`Tiles saved to: ${outputSubDir}`);
  console.log(`Metadata saved to: ${path.join(outputSubDir, "metadata.json")}`);

  return { baseName, tilesX, tilesY, outputSubDir };
}

async function main() {
  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Find all GeoTIFF files in source directory
  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith(".tif") || f.endsWith(".tiff"))
    .map((f) => path.join(SOURCE_DIR, f));

  console.log(`Found ${files.length} GeoTIFF file(s)`);

  for (const file of files) {
    try {
      await processGeoTiff(file);
      console.log("---");
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }

  console.log("Done!");
}

main().catch(console.error);
