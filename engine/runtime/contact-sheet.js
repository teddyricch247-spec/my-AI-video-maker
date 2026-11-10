// Contact sheet drawn in the page: tiles of the scene at chosen times, each labelled "<seconds>s f<frame>".
export function layoutFor(n) {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 2 };               // 5 or 6 tiles
}

export function renderContactSheet(R, { times, cols, tileW = 640, fps }) {
  if (!Array.isArray(times) || times.length < 1 || times.length > 6) throw new Error('strip needs 1..6 times');
  const tileH = Math.round((tileW * 9) / 16);
  const lay = layoutFor(times.length);
  const nCols = cols || lay.cols;
  const nRows = Math.ceil(times.length / nCols);
  const sheet = document.createElement('canvas');
  sheet.width = nCols * tileW;
  sheet.height = nRows * tileH;
  const sg = sheet.getContext('2d');
  sg.fillStyle = '#2a2a2a';
  sg.fillRect(0, 0, sheet.width, sheet.height);
  sg.imageSmoothingQuality = 'high';
  times.forEach((t, i) => {
    R.drawFrame(t, tileW / 1280);              // render the tile natively at tile size: no resampling
    const x = (i % nCols) * tileW;
    const y = Math.floor(i / nCols) * tileH;
    sg.drawImage(R.canvas, x, y, tileW, tileH);
    const label = `${t.toFixed(2)}s f${Math.round(t * fps)}`;
    sg.font = 'bold 13px "DejaVu Sans Mono", monospace';
    sg.textBaseline = 'top';
    const w = sg.measureText(label).width;
    sg.fillStyle = 'rgba(0,0,0,0.65)';
    sg.fillRect(x + 6, y + 6, w + 12, 22);
    sg.fillStyle = '#ffffff';
    sg.fillText(label, x + 12, y + 10);
  });
  return sheet;
}
