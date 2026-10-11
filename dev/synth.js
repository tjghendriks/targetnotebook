// Draws a synthetic photo of a shot card for testing the detector.
// `shots` holds one entry per shot, grouped by diagram, as on a saved card.

export function drawCard(card, shots, { pxPerMm = 8, rotate = 0, shear = 0, noise = 6, backing = '#f4f4f0', hole = 5.0 } = {}) {
  const W = Math.round(420 * pxPerMm);
  const Hh = Math.round(300 * pxPerMm);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Hh;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, W, Hh);
  grad.addColorStop(0, '#d9d6cf'); grad.addColorStop(1, '#bdb9b0');
  g.fillStyle = grad; g.fillRect(0, 0, W, Hh);
  g.translate(W / 2, Hh / 2);
  g.rotate(rotate * Math.PI / 180);
  g.transform(1, 0, shear, 1, 0, 0);
  g.scale(pxPerMm, pxPerMm);
  const paper = '#e3c39a';
  const ink = '#231f1c';
  g.fillStyle = paper;
  g.fillRect(-card.width / 2, -card.height / 2, card.width, card.height);
  if (card.trim) {
    g.strokeStyle = '#3a3026'; g.lineWidth = 0.25; g.setLineDash([0.6, 0.6]);
    g.strokeRect(-card.trim.width / 2, -card.trim.height / 2, card.trim.width, card.trim.height);
    g.setLineDash([]);
  }
  const markR = card.aimingMarkDia / 2;
  for (const d of card.diagrams) {
    g.fillStyle = ink;
    g.beginPath(); g.arc(d.x, d.y, markR, 0, 7); g.fill();
    g.lineWidth = 0.3;
    for (const r of card.rings) {
      if (Math.abs(r.dia / 2 - markR) < 0.2) continue;
      g.strokeStyle = r.dia / 2 < markR ? paper : ink;
      g.beginPath(); g.arc(d.x, d.y, r.dia / 2 - 0.15, 0, 7); g.stroke();
    }
    g.font = '2.6px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const nm of card.numerals) {
      g.fillStyle = nm.r < markR ? paper : ink;
      for (const [ux, uy] of nm.at) g.fillText(nm.text, d.x + ux * nm.r, d.y + uy * nm.r);
    }
    if (card.centreDot) { g.fillStyle = paper; g.beginPath(); g.arc(d.x, d.y, 0.35, 0, 7); g.fill(); }
  }
  shots.forEach((s, i) => {
    if (!s) return;
    const d = card.diagrams[Math.floor(i / card.shotsPerDiagram)];
    g.fillStyle = backing;
    g.beginPath(); g.arc(d.x + s.x, d.y - s.y, hole / 2, 0, 7); g.fill();
  });
  if (noise) {
    const im = g.getImageData(0, 0, W, Hh);
    for (let i = 0; i < im.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 2 * noise;
      im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n;
    }
    g.putImageData(im, 0, 0);
  }
  return cv;
}
