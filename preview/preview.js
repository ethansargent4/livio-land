const svg = document.getElementById("plotter");
const parcelLayer = document.getElementById("parcelLayer");
const exclusionLayer = document.getElementById("exclusionLayer");
const pointLayer = document.getElementById("pointLayer");
const layoutLayer = document.getElementById("layoutLayer");
const saveCutoutButton = document.querySelector("[data-action='save-exclusion']");
const ns = "http://www.w3.org/2000/svg";
const FIT_SCENARIOS = {
  balanced: {
    label: "Balanced",
    description: "Balanced pad, utility yard, and truck/fire access reserves.",
    driveRatio: 0.12,
    yardRatio: 0.18,
    gapRatio: 0.025,
    maxHalls: 6,
    mwPerHallAcre: 18,
    scoreBoost: 1,
  },
  dense: {
    label: "High density",
    description: "Prioritizes maximum data hall yield while keeping clear of cutouts.",
    driveRatio: 0.09,
    yardRatio: 0.13,
    gapRatio: 0.018,
    maxHalls: 8,
    mwPerHallAcre: 22,
    scoreBoost: 1.12,
  },
  resilient: {
    label: "Resilient",
    description: "Larger service, utility, and access reserves for conservative planning.",
    driveRatio: 0.16,
    yardRatio: 0.24,
    gapRatio: 0.035,
    maxHalls: 5,
    mwPerHallAcre: 14,
    scoreBoost: 0.92,
  },
};

let mode = "boundary";
let dragTarget = null;
let activeScenario = "balanced";
let boundary = [
  { x: 168, y: 168 },
  { x: 780, y: 126 },
  { x: 850, y: 440 },
  { x: 650, y: 536 },
  { x: 246, y: 500 },
  { x: 116, y: 318 },
];
let exclusions = [[
  { x: 470, y: 250 },
  { x: 570, y: 248 },
  { x: 594, y: 332 },
  { x: 506, y: 372 },
  { x: 444, y: 318 },
]];
let draftExclusion = [];
let optimizedLayout = null;

checkGoogleMapsKey();

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
  });
});

document.querySelector("[data-action='optimize']").addEventListener("click", () => {
  optimizedLayout = optimize(boundary, exclusions, FIT_SCENARIOS[activeScenario]);
  render();
});

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    activeScenario = button.dataset.scenario;
    document.querySelectorAll("[data-scenario]").forEach((item) => item.classList.toggle("active", item === button));
    optimizedLayout = boundary.length >= 3 ? optimize(boundary, exclusions, FIT_SCENARIOS[activeScenario]) : null;
    render();
  });
});

saveCutoutButton.addEventListener("click", () => {
  finishDraftExclusion();
});

document.querySelector("[data-action='undo']").addEventListener("click", () => {
  if (mode === "exclusion" && draftExclusion.length) draftExclusion.pop();
  else if (mode === "boundary") boundary.pop();
  optimizedLayout = null;
  render();
});

document.querySelector("[data-action='clear']").addEventListener("click", () => {
  boundary = [];
  exclusions = [];
  draftExclusion = [];
  optimizedLayout = null;
  render();
});

svg.addEventListener("pointerdown", (event) => {
  const point = svgPoint(event);
  const target = event.target.closest("[data-kind]");
  if (target) {
    dragTarget = {
      kind: target.dataset.kind,
      index: target.dataset.index,
      path: target.dataset.path,
    };
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }

  if (mode === "boundary") {
    boundary.push(point);
    optimizedLayout = null;
  } else if (mode === "exclusion" && boundary.length >= 3) {
    draftExclusion.push(point);
    optimizedLayout = null;
  }
  render();
});

svg.addEventListener("pointermove", (event) => {
  if (!dragTarget) return;
  const point = svgPoint(event);
  const index = Number(dragTarget.index);
  if (dragTarget.kind === "boundary") boundary[index] = point;
  if (dragTarget.kind === "exclusion") exclusions[Number(dragTarget.path)][index] = point;
  if (dragTarget.kind === "draft") draftExclusion[index] = point;
  optimizedLayout = null;
  render();
});

svg.addEventListener("pointerup", (event) => {
  if (dragTarget) svg.releasePointerCapture(event.pointerId);
  dragTarget = null;
});

svg.addEventListener("dblclick", (event) => {
  const target = event.target.closest("[data-kind]");
  if (!target) return;
  const index = Number(target.dataset.index);
  if (target.dataset.kind === "boundary") boundary.splice(index, 1);
  if (target.dataset.kind === "exclusion") {
    const path = Number(target.dataset.path);
    exclusions[path].splice(index, 1);
    exclusions = exclusions.filter((item) => item.length >= 3);
  }
  if (target.dataset.kind === "draft") draftExclusion.splice(index, 1);
  optimizedLayout = null;
  render();
});

function finishDraftExclusion() {
  if (draftExclusion.length < 3) return;
  exclusions.push([...draftExclusion]);
  draftExclusion = [];
  optimizedLayout = null;
  mode = "boundary";
  document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item.dataset.mode === "boundary"));
  render();
}

function render() {
  clear(parcelLayer);
  clear(exclusionLayer);
  clear(pointLayer);
  clear(layoutLayer);

  drawLayout();
  if (boundary.length >= 3) drawPolygon(parcelLayer, boundary, "url(#parcelFill)", "#06adf5", 3);
  exclusions.forEach((path) => drawPolygon(exclusionLayer, path, "rgba(239,68,68,.3)", "#ef4444", 2));
  if (draftExclusion.length >= 3) drawPolygon(exclusionLayer, draftExclusion, "rgba(249,115,22,.24)", "#f97316", 2);
  if (draftExclusion.length >= 2) drawPolyline(exclusionLayer, draftExclusion, "#f97316", 2);

  boundary.forEach((point, index) => drawPoint(point, index, "#06adf5", "boundary"));
  exclusions.forEach((path, pathIndex) => path.forEach((point, index) => drawPoint(point, index, "#ef4444", "exclusion", pathIndex)));
  draftExclusion.forEach((point, index) => drawPoint(point, index, "#f97316", "draft"));

  const gross = polygonArea(boundary) / 43560;
  const excluded = exclusions.reduce((sum, path) => sum + polygonArea(path) / 43560, 0);
  const net = Math.max(gross - excluded, 0);

  setText("dotCount", boundary.length);
  setText("grossArea", `${gross.toFixed(1)} ac`);
  setText("excludedArea", `${excluded.toFixed(1)} ac`);
  setText("netArea", `${net.toFixed(1)} ac`);

  if (optimizedLayout) {
    setText("padArea", `${optimizedLayout.padAcres.toFixed(1)} ac`);
    setText("hallCount", optimizedLayout.halls.length);
    setText("angle", `${optimizedLayout.angleDegrees.toFixed(0)}deg`);
    setText("mwEstimate", `${optimizedLayout.estimatedMw} MW`);
    setText("utilization", `${optimizedLayout.padUtilization}%`);
    setText("fitScore", optimizedLayout.fitScore);
    setText("optimizationNote", `${optimizedLayout.scenario.label}: ${optimizedLayout.scenario.description}`);
  } else {
    setText("padArea", "--");
    setText("hallCount", "--");
    setText("angle", "--");
    setText("mwEstimate", "--");
    setText("utilization", "--");
    setText("fitScore", "--");
    setText(
      "optimizationNote",
      mode === "exclusion"
        ? draftExclusion.length < 3
          ? `Negative space: add ${3 - draftExclusion.length} more dot${3 - draftExclusion.length === 1 ? "" : "s"}, then Save cutout.`
          : "Negative space ready. Click Save cutout to subtract it from usable land."
        : `Click Optimize layout to run the ${FIT_SCENARIOS[activeScenario].label} test fit.`
    );
  }

  saveCutoutButton.disabled = draftExclusion.length < 3;

  document.getElementById("jsonOut").textContent = JSON.stringify({
    boundary,
    exclusions,
    grossAcres: Number(gross.toFixed(2)),
    excludedAcres: Number(excluded.toFixed(2)),
    netAcres: Number(net.toFixed(2)),
    activeScenario,
    optimizedLayout,
  }, null, 2);
}

function drawLayout() {
  if (!optimizedLayout) return;
  drawPolygon(layoutLayer, optimizedLayout.pad, "rgba(251,191,36,.22)", "#f59e0b", 3);
  drawPolygon(layoutLayer, optimizedLayout.drive, "rgba(100,116,139,.42)", "#475569", 2);
  optimizedLayout.halls.forEach((hall) => drawPolygon(layoutLayer, hall, "rgba(6,173,245,.42)", "#0f6fa8", 2));
  drawPolygon(layoutLayer, optimizedLayout.yard, "rgba(16,185,129,.38)", "#047857", 2);
}

function optimize(poly, holes, scenario = FIT_SCENARIOS.balanced) {
  if (poly.length < 3) return null;
  let best = null;
  for (let deg = 0; deg < 180; deg += 10) {
    const angle = (deg * Math.PI) / 180;
    const rotated = poly.map((point) => rotate(point, -angle));
    const rotatedHoles = holes.map((path) => path.map((point) => rotate(point, -angle)));
    const bounds = getBounds(rotated);
    const xs = grid(bounds.minX, bounds.maxX, 26);
    const ys = grid(bounds.minY, bounds.maxY, 26);

    for (let left = 0; left < xs.length - 1; left++) {
      for (let right = left + 1; right < xs.length; right++) {
        const width = xs[right] - xs[left];
        if (width < 60) continue;
        for (let bottom = 0; bottom < ys.length - 1; bottom++) {
          for (let top = bottom + 1; top < ys.length; top++) {
            const height = ys[top] - ys[bottom];
            if (height < 60) continue;
            const rect = { minX: xs[left], maxX: xs[right], minY: ys[bottom], maxY: ys[top] };
            if (!rectClear(rect, rotated, rotatedHoles)) continue;
            const area = width * height;
            const aspect = Math.max(width, height) / Math.max(Math.min(width, height), 1);
            const score = area * (aspect > 4 ? 0.55 : aspect > 2.8 ? 0.82 : 1) * scenario.scoreBoost;
            if (!best || score > best.score) best = { ...rect, angle, area, score };
          }
        }
      }
    }
  }
  if (!best) return null;

  const width = best.maxX - best.minX;
  const height = best.maxY - best.minY;
  const minPadDimension = Math.min(width, height);
  const driveDepth = clampAvailable(height * scenario.driveRatio, Math.min(28, height * scenario.driveRatio), height * 0.24);
  const gap = clampAvailable(minPadDimension * scenario.gapRatio, Math.min(8, minPadDimension * scenario.gapRatio), minPadDimension * 0.07);
  const yardWidth = clampAvailable(width * scenario.yardRatio, Math.min(46, width * scenario.yardRatio), width * 0.3);
  const drive = { minX: best.minX, maxX: best.maxX, minY: best.minY, maxY: best.minY + driveDepth };
  const yard = { minX: best.maxX - yardWidth, maxX: best.maxX, minY: drive.maxY, maxY: best.maxY };
  const zone = { minX: best.minX + gap, maxX: yard.minX - gap, minY: drive.maxY + gap, maxY: best.maxY - gap };
  const hallRects = splitHalls(zone, width, height, scenario);
  const halls = hallRects.map((rect) => rectPoints(rect).map((point) => rotate(point, best.angle)));
  const hallAcres = hallRects.reduce((sum, rect) => sum + ((rect.maxX - rect.minX) * (rect.maxY - rect.minY)) / 43560, 0);
  const padAcres = best.area / 43560;
  const padUtilization = padAcres ? Math.round((hallAcres / padAcres) * 100) : 0;
  const estimatedMw = Math.round(hallAcres * scenario.mwPerHallAcre);
  const fitScore = Math.max(0, Math.min(100, Math.round((padUtilization * 0.7) + (Math.min(estimatedMw, 180) / 180) * 30)));

  return {
    scenario: { id: activeScenario, label: scenario.label, description: scenario.description },
    pad: rectPoints(best).map((point) => rotate(point, best.angle)),
    drive: rectPoints(drive).map((point) => rotate(point, best.angle)),
    yard: rectPoints(yard).map((point) => rotate(point, best.angle)),
    halls,
    hallAcres,
    padAcres,
    padUtilization,
    estimatedMw,
    fitScore,
    angleDegrees: (best.angle * 180) / Math.PI,
  };
}

function splitHalls(zone, width, height, scenario = FIT_SCENARIOS.balanced) {
  const zoneWidth = Math.max(zone.maxX - zone.minX, 0);
  const zoneHeight = Math.max(zone.maxY - zone.minY, 0);
  if (zoneWidth < 40 || zoneHeight < 40) return [];
  const cols = scenario === FIT_SCENARIOS.dense ? (zoneWidth > 640 ? 4 : zoneWidth > 280 ? 3 : zoneWidth > 150 ? 2 : 1) : zoneWidth > 500 ? 3 : zoneWidth > 210 ? 2 : 1;
  const rows = scenario === FIT_SCENARIOS.dense ? (zoneHeight > 420 ? 3 : zoneHeight > 220 ? 2 : 1) : zoneHeight > 340 ? 2 : 1;
  const minPadDimension = Math.min(width, height);
  const gap = clampAvailable(minPadDimension * scenario.gapRatio, Math.min(7, minPadDimension * scenario.gapRatio), Math.min(22, minPadDimension * 0.06));
  const hallWidth = (zoneWidth - gap * (cols - 1)) / cols;
  const hallHeight = (zoneHeight - gap * (rows - 1)) / rows;
  const halls = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      halls.push({
        minX: zone.minX + col * (hallWidth + gap),
        maxX: zone.minX + col * (hallWidth + gap) + hallWidth,
        minY: zone.minY + row * (hallHeight + gap),
        maxY: zone.minY + row * (hallHeight + gap) + hallHeight,
      });
    }
  }
  return halls.slice(0, scenario.maxHalls);
}

function rectClear(rect, poly, holes) {
  const corners = rectPoints(rect);
  const center = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 };
  if (![...corners, center].every((point) => pointInPolygon(point, poly))) return false;
  if (rectIntersectsPolygonBoundary(rect, poly)) return false;
  return holes.every((hole) => !rectOverlapsPolygon(rect, hole));
}

function rectEdges(rect) {
  const corners = rectPoints(rect);
  return corners.map((point, index) => [point, corners[(index + 1) % corners.length]]);
}

function polygonEdges(polygon) {
  return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]]);
}

function rectIntersectsPolygonBoundary(rect, polygon) {
  return rectEdges(rect).some(([rectStart, rectEnd]) =>
    polygonEdges(polygon).some(([polyStart, polyEnd]) => segmentsIntersect(rectStart, rectEnd, polyStart, polyEnd))
  );
}

function rectOverlapsPolygon(rect, polygon) {
  if (polygon.length < 3) return false;
  if (rectPoints(rect).some((corner) => pointInPolygon(corner, polygon) || pointOnPolygonBoundary(corner, polygon))) return true;
  if (polygon.some((point) => pointInRect(point, rect))) return true;
  return rectIntersectsPolygonBoundary(rect, polygon);
}

function pointInRect(point, rect) {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

function pointOnPolygonBoundary(point, polygon) {
  return polygonEdges(polygon).some(([start, end]) => pointOnSegment(point, start, end));
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c, a, b)) return true;
  if (o2 === 0 && pointOnSegment(d, a, b)) return true;
  if (o3 === 0 && pointOnSegment(a, c, d)) return true;
  if (o4 === 0 && pointOnSegment(b, c, d)) return true;
  return false;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function pointOnSegment(point, start, end) {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  return (
    point.x >= Math.min(start.x, end.x) - 1e-9 &&
    point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 &&
    point.y <= Math.max(start.y, end.y) + 1e-9
  );
}

function rectPoints(rect) {
  return [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
}

function drawPolygon(parent, points, fill, stroke, width) {
  const polygon = document.createElementNS(ns, "polygon");
  polygon.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
  polygon.setAttribute("fill", fill);
  polygon.setAttribute("stroke", stroke);
  polygon.setAttribute("stroke-width", width);
  polygon.setAttribute("stroke-linejoin", "round");
  parent.appendChild(polygon);
}

function drawPolyline(parent, points, stroke, width) {
  const line = document.createElementNS(ns, "polyline");
  line.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", width);
  parent.appendChild(line);
}

function drawPoint(point, index, color, kind, path) {
  const group = document.createElementNS(ns, "g");
  const hit = document.createElementNS(ns, "circle");
  const circle = document.createElementNS(ns, "circle");
  const label = document.createElementNS(ns, "text");
  Object.assign(group.dataset, { kind, index, path: path ?? "" });
  Object.assign(hit.dataset, { kind, index, path: path ?? "" });
  Object.assign(circle.dataset, { kind, index, path: path ?? "" });
  hit.setAttribute("cx", point.x);
  hit.setAttribute("cy", point.y);
  hit.setAttribute("r", 24);
  hit.setAttribute("fill", "transparent");
  hit.setAttribute("stroke", "none");
  hit.style.cursor = "grab";
  circle.setAttribute("cx", point.x);
  circle.setAttribute("cy", point.y);
  circle.setAttribute("r", 12);
  circle.setAttribute("fill", color);
  circle.setAttribute("stroke", "#fff");
  circle.setAttribute("stroke-width", 3);
  circle.style.cursor = "grab";
  label.setAttribute("x", point.x);
  label.setAttribute("y", point.y + 4);
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("fill", "#fff");
  label.setAttribute("font-size", "11");
  label.setAttribute("font-weight", "900");
  label.setAttribute("pointer-events", "none");
  label.textContent = String(index + 1);
  group.style.cursor = "grab";
  group.append(hit, circle, label);
  pointLayer.appendChild(group);
}

function clear(node) {
  node.replaceChildren();
}

function svgPoint(event) {
  const pt = svg.createSVGPoint();
  pt.x = event.clientX;
  pt.y = event.clientY;
  const transformed = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: transformed.x, y: transformed.y };
}

function polygonArea(points) {
  if (points.length < 3) return 0;
  let sum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    sum += point.x * next.y - next.x * point.y;
  });
  return Math.abs(sum / 2);
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses = currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y + Number.EPSILON) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function getBounds(points) {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function grid(min, max, steps) {
  return Array.from({ length: steps + 1 }, (_, index) => min + ((max - min) * index) / steps);
}

function rotate(point, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampAvailable(value, min, max) {
  return max < min ? Math.max(0, max) : clamp(value, min, max);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function checkGoogleMapsKey() {
  const keyStatus = document.getElementById("keyStatus");
  const key = (window.LIVIO_GOOGLE_MAPS_API_KEY || "").trim();
  if (!key) {
    keyStatus.className = "key-status missing";
    keyStatus.querySelector("strong").textContent = "Missing";
    return;
  }

  keyStatus.className = "key-status";
  keyStatus.querySelector("strong").textContent = "Loading";

  const callbackName = `__livioPreviewGoogleMaps_${Date.now()}`;
  const timeout = window.setTimeout(() => {
    keyStatus.className = "key-status failed";
    keyStatus.querySelector("strong").textContent = "Timed out";
    cleanup();
  }, 10000);

  function cleanup() {
    window.clearTimeout(timeout);
    delete window[callbackName];
    delete window.gm_authFailure;
  }

  window.gm_authFailure = () => {
    keyStatus.className = "key-status failed";
    keyStatus.querySelector("strong").textContent = "Rejected";
    cleanup();
  };

  window[callbackName] = () => {
    keyStatus.className = "key-status connected";
    keyStatus.querySelector("strong").textContent = "Connected";
    cleanup();
  };

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${callbackName}`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    keyStatus.className = "key-status failed";
    keyStatus.querySelector("strong").textContent = "Failed";
    cleanup();
  };
  document.head.appendChild(script);
}

render();
