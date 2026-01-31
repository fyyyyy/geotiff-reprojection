async function loadTiles() {
  const metadataRes = await fetch('/output/1024/n34_w093_1arc_v2/metadata.json');
  const metadata = await metadataRes.json();

  document.getElementById('metadata').textContent = JSON.stringify(metadata, null, 2);

  const grid = document.getElementById('tile-grid');
  const { rows, columns } = metadata.tileGrid;
  const tileSize = metadata.tileSize;
  const { width, height } = metadata.reprojectedDimensions;

  // Calculate column widths (last column may be smaller)
  const lastColWidth = width % tileSize || tileSize;
  const colWidths = Array(columns - 1).fill(`${tileSize}px`).concat(`${lastColWidth}px`);

  // Calculate row heights (last row may be smaller)
  const lastRowHeight = height % tileSize || tileSize;
  const rowHeights = Array(rows - 1).fill(`${tileSize}px`).concat(`${lastRowHeight}px`);

  grid.style.gridTemplateColumns = colWidths.join(' ');
  grid.style.gridTemplateRows = rowHeights.join(' ');

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const img = document.createElement('img');
      img.src = `/output/1024/n34_w093_1arc_v2/tile_${row}_${col}.png`;
      img.alt = `Tile ${row},${col}`;
      img.style.width = '100%';
      img.style.height = '100%';
      grid.appendChild(img);
    }
  }
}

loadTiles();
