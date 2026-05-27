const keyStatus = document.getElementById("keyStatus");
const blocker = document.getElementById("mapBlocker");
const mapEl = document.getElementById("googleMap");
const saveCutoutButton = document.querySelector("[data-action='save-exclusion']");
const apiKeyInput = document.getElementById("apiKeyInput");
const connectKeyButton = document.getElementById("connectKeyButton");
const pasteKeyButton = document.getElementById("pasteKeyButton");
const LOCAL_KEY = "livio-grid-google-maps-api-key";

let mode = "boundary";
let map;
let parcelPolygon;
let draftPolyline;
let draftPolygon;
let markers = [];
let layoutPolygons = [];
let optimizedLayout = null;
let boundary = [
  { lat: 36.3278, lng: -96.9687 },
  { lat: 36.3282, lng: -96.9624 },
  { lat: 36.3255, lng: -96.9617 },
  { lat: 36.3237, lng: -96.9643 },
  { lat: 36.3242, lng: -96.9689 },
];
let exclusions = [[
  { lat: 36.3267, lng: -96.9659 },
  { lat: 36.3269, lng: -96.9647 },
  { lat: 36.3261, lng: -96.9643 },
  { lat: 36.3257, lng: -96.9653 },
]];
let draftExclusion = [];

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item === button));
    writeMetrics();
  });
});

document.querySelector("[data-action='optimize']").addEventListener("click", () => {
  optimizedLayout = optimizeLatLng(boundary, exclusions);
  render();
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

saveCutoutButton.addEventListener("click", () => finishDraftExclusion());

connectKeyButton.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  localStorage.setItem(LOCAL_KEY, key);
  loadGoogleMaps();
});

pasteKeyButton.addEventListener("click", async () => {
  try {
    const key = (await navigator.clipboard.readText()).trim();
    if (!key) return;
    apiKeyInput.value = key;
    localStorage.setItem(LOCAL_KEY, key);
    loadGoogleMaps();
  } catch {
    setKeyState("failed", "Clipboard blocked");
    blocker.querySelector("strong").textContent = "Clipboard access blocked";
    blocker.querySelector("span").textContent = "Paste the key into the field manually, then click Connect Google Earth.";
  }
});

apiKeyInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  connectKeyButton.click();
});

function loadGoogleMaps() {
  const key = getGoogleMapsKey();
  if (!key) {
    setKeyState("missing", "Missing");
    blocker.hidden = false;
    writeMetrics();
    return;
  }

  setKeyState("", "Loading");
  blocker.hidden = false;
  blocker.querySelector("strong").textContent = "Connecting to Google satellite imagery";
  blocker.querySelector("span").textContent = "Loading Google Maps JavaScript API...";
  const callbackName = `__livioEarthMap_${Date.now()}`;
  const timeout = window.setTimeout(() => {
    setKeyState("failed", "Timed out");
    cleanup();
  }, 12000);

  function cleanup() {
    window.clearTimeout(timeout);
    delete window[callbackName];
    delete window.gm_authFailure;
  }

  window.gm_authFailure = () => {
    setKeyState("failed", "Rejected");
    localStorage.removeItem(LOCAL_KEY);
    blocker.hidden = false;
    blocker.querySelector("strong").textContent = "Google rejected this key";
    blocker.querySelector("span").textContent = "Check that Maps JavaScript API is enabled and localhost is allowed in key restrictions.";
    cleanup();
  };

  window[callbackName] = () => {
    cleanup();
    setKeyState("connected", "Connected");
    blocker.hidden = true;
    initMap();
  };

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=geometry&loading=async&callback=${callbackName}`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    setKeyState("failed", "Failed");
    blocker.hidden = false;
    blocker.querySelector("strong").textContent = "Google Maps failed to load";
    blocker.querySelector("span").textContent = "Check the network, key, billing, and Maps JavaScript API settings.";
    cleanup();
  };
  document.head.appendChild(script);
}

function getGoogleMapsKey() {
  return (localStorage.getItem(LOCAL_KEY) || window.LIVIO_GOOGLE_MAPS_API_KEY || "").trim();
}

function getGoogleMapId() {
  return (window.LIVIO_GOOGLE_MAP_ID || "").trim();
}

function initMap() {
  map = new google.maps.Map(mapEl, {
    center: { lat: 36.326, lng: -96.965 },
    zoom: 17,
    mapId: getGoogleMapId() || undefined,
    mapTypeId: google.maps.MapTypeId.HYBRID,
    clickableIcons: false,
    fullscreenControl: true,
    mapTypeControl: true,
    streetViewControl: false,
    scaleControl: true,
    gestureHandling: "greedy",
  });

  map.addListener("click", (event) => {
    if (!event.latLng) return;
    const point = normalize(event.latLng);
    if (mode === "boundary") boundary.push(point);
    if (mode === "exclusion" && boundary.length >= 3) draftExclusion.push(point);
    optimizedLayout = null;
    render();
  });

  fitBoundary();
  render();
}

function render() {
  if (!map) {
    writeMetrics();
    return;
  }

  clearOverlays();
  const paths = [
    boundary,
    ...exclusions.map((path) => orientHoleOppositeBoundary(boundary, path)),
  ].filter((path) => path.length >= 3);

  parcelPolygon = new google.maps.Polygon({
    map,
    paths,
    clickable: false,
    strokeColor: "#06adf5",
    strokeOpacity: 1,
    strokeWeight: 3,
    fillColor: "#06adf5",
    fillOpacity: 0.22,
  });

  if (draftExclusion.length >= 2) {
    draftPolyline = new google.maps.Polyline({
      map,
      path: draftExclusion,
      clickable: false,
      strokeColor: "#f97316",
      strokeOpacity: 1,
      strokeWeight: 3,
    });
  }

  if (draftExclusion.length >= 3) {
    draftPolygon = new google.maps.Polygon({
      map,
      paths: draftExclusion,
      clickable: false,
      strokeColor: "#f97316",
      strokeOpacity: 1,
      strokeWeight: 2,
      fillColor: "#f97316",
      fillOpacity: 0.24,
    });
  }

  drawLayout();
  boundary.forEach((point, index) => addMarker(point, index, "#06adf5", (next) => boundary[index] = next, () => boundary.splice(index, 1)));
  exclusions.forEach((path, pathIndex) => path.forEach((point, index) => {
    addMarker(point, index, "#ef4444", (next) => path[index] = next, () => {
      exclusions[pathIndex].splice(index, 1);
      exclusions = exclusions.filter((item) => item.length >= 3);
    });
  }));
  draftExclusion.forEach((point, index) => addMarker(point, index, "#f97316", (next) => draftExclusion[index] = next, () => draftExclusion.splice(index, 1)));
  writeMetrics();
}

function finishDraftExclusion() {
  if (draftExclusion.length < 3) return;
  exclusions.push([...draftExclusion]);
  draftExclusion = [];
  optimizedLayout = null;
  mode = "boundary";
  document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item.dataset.mode === "boundary"));
  render();
}

function addMarker(point, index, color, onDrag, onRemove) {
  const marker = new google.maps.Marker({
    map,
    position: point,
    draggable: true,
    label: { text: String(index + 1), color: "#ffffff", fontSize: "11px", fontWeight: "700" },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: "#ffffff",
      strokeWeight: 2,
    },
  });
  marker.addListener("drag", (event) => {
    if (!event.latLng) return;
    onDrag(normalize(event.latLng));
    optimizedLayout = null;
    render();
  });
  marker.addListener("dblclick", () => {
    onRemove();
    optimizedLayout = null;
    render();
  });
  markers.push(marker);
}

function drawLayout() {
  if (!optimizedLayout) return;
  addLayoutPolygon(optimizedLayout.pad, "#f59e0b", "#fbbf24", 0.18);
  addLayoutPolygon(optimizedLayout.drive, "#475569", "#64748b", 0.34);
  optimizedLayout.halls.forEach((hall) => addLayoutPolygon(hall, "#0f6fa8", "#06adf5", 0.42));
  addLayoutPolygon(optimizedLayout.yard, "#047857", "#10b981", 0.36);
}

function addLayoutPolygon(points, strokeColor, fillColor, fillOpacity) {
  const polygon = new google.maps.Polygon({
    map,
    paths: points,
    clickable: false,
    strokeColor,
    strokeOpacity: 0.95,
    strokeWeight: 2,
    fillColor,
    fillOpacity,
  });
  layoutPolygons.push(polygon);
}

function clearOverlays() {
  if (parcelPolygon) parcelPolygon.setMap(null);
  if (draftPolyline) draftPolyline.setMap(null);
  if (draftPolygon) draftPolygon.setMap(null);
  markers.forEach((marker) => marker.setMap(null));
  layoutPolygons.forEach((polygon) => polygon.setMap(null));
  markers = [];
  layoutPolygons = [];
  parcelPolygon = null;
  draftPolyline = null;
  draftPolygon = null;
}

function writeMetrics() {
  const gross = areaAcres(boundary);
  const excluded = exclusions.reduce((sum, path) => sum + areaAcres(path), 0);
  const net = Math.max(gross - excluded, 0);
  setText("dotCount", boundary.length);
  setText("grossArea", `${gross.toFixed(1)} ac`);
  setText("excludedArea", `${excluded.toFixed(1)} ac`);
  setText("netArea", `${net.toFixed(1)} ac`);
  saveCutoutButton.disabled = draftExclusion.length < 3;

  if (optimizedLayout) {
    setText("padArea", `${optimizedLayout.padAcres.toFixed(1)} ac`);
    setText("hallCount", optimizedLayout.halls.length);
    setText("angle", `${optimizedLayout.angleDegrees.toFixed(0)}deg`);
    setText("optimizationNote", "Optimized directly on the Google satellite map.");
  } else {
    setText("padArea", "--");
    setText("hallCount", "--");
    setText("angle", "--");
    setText(
      "optimizationNote",
      mode === "exclusion"
        ? draftExclusion.length < 3
          ? `Negative space: add ${3 - draftExclusion.length} more dot${3 - draftExclusion.length === 1 ? "" : "s"}, then Save cutout.`
          : "Negative space ready. Click Save cutout to subtract it from usable land."
        : map
          ? "Click Optimize layout after drawing three or more boundary dots."
          : "Waiting for a valid Google Maps API key."
    );
  }

  document.getElementById("jsonOut").textContent = JSON.stringify({
    boundary,
    exclusions,
    grossAcres: Number(gross.toFixed(2)),
    excludedAcres: Number(excluded.toFixed(2)),
    netAcres: Number(net.toFixed(2)),
    optimizedLayout,
  }, null, 2);
}

function fitBoundary() {
  if (!map || boundary.length < 3) return;
  const bounds = new google.maps.LatLngBounds();
  boundary.forEach((point) => bounds.extend(point));
  map.fitBounds(bounds, 64);
}

function areaAcres(points) {
  if (points.length < 3 || !window.google?.maps?.geometry?.spherical) return 0;
  return google.maps.geometry.spherical.computeArea(points) / 4046.8564224;
}

function normalize(latLng) {
  return {
    lat: Number(latLng.lat().toFixed(7)),
    lng: Number(latLng.lng().toFixed(7)),
  };
}

function optimizeLatLng(poly, holes) {
  if (poly.length < 3) return null;
  const projection = createProjection(poly);
  const xyBoundary = poly.map(projection.toXY);
  const xyHoles = holes.map((path) => path.map(projection.toXY));
  const best = findBestRect(xyBoundary, xyHoles);
  if (!best) return null;

  const toLatLngRect = (rect) => rectPoints(rect).map((point) => projection.toLatLng(rotate(point, best.angle)));
  const width = best.maxX - best.minX;
  const height = best.maxY - best.minY;
  const minPadDimension = Math.min(width, height);
  const driveDepth = clampAvailable(height * 0.12, Math.min(30, height * 0.12), height * 0.22);
  const gap = clampAvailable(minPadDimension * 0.025, Math.min(10, minPadDimension * 0.025), minPadDimension * 0.06);
  const yardWidth = clampAvailable(width * 0.18, Math.min(55, width * 0.12), width * 0.26);
  const drive = { minX: best.minX, maxX: best.maxX, minY: best.minY, maxY: best.minY + driveDepth };
  const yard = { minX: best.maxX - yardWidth, maxX: best.maxX, minY: drive.maxY, maxY: best.maxY };
  const zone = { minX: best.minX + gap, maxX: yard.minX - gap, minY: drive.maxY + gap, maxY: best.maxY - gap };

  return {
    pad: toLatLngRect(best),
    drive: toLatLngRect(drive),
    yard: toLatLngRect(yard),
    halls: splitHalls(zone, width, height).map(toLatLngRect),
    padAcres: best.area / 43560,
    angleDegrees: (best.angle * 180) / Math.PI,
  };
}

function findBestRect(boundaryXY, holesXY) {
  let best = null;
  for (let deg = 0; deg < 180; deg += 10) {
    const angle = (deg * Math.PI) / 180;
    const rotated = boundaryXY.map((point) => rotate(point, -angle));
    const rotatedHoles = holesXY.map((path) => path.map((point) => rotate(point, -angle)));
    const bounds = getBounds(rotated);
    const xs = grid(bounds.minX, bounds.maxX, 26);
    const ys = grid(bounds.minY, bounds.maxY, 26);
    for (let left = 0; left < xs.length - 1; left++) {
      for (let right = left + 1; right < xs.length; right++) {
        const width = xs[right] - xs[left];
        if (width < 80) continue;
        for (let bottom = 0; bottom < ys.length - 1; bottom++) {
          for (let top = bottom + 1; top < ys.length; top++) {
            const height = ys[top] - ys[bottom];
            if (height < 80) continue;
            const rect = { minX: xs[left], maxX: xs[right], minY: ys[bottom], maxY: ys[top] };
            if (!rectClear(rect, rotated, rotatedHoles)) continue;
            const area = width * height;
            const aspect = Math.max(width, height) / Math.max(Math.min(width, height), 1);
            const score = area * (aspect > 5 ? 0.35 : aspect > 3.5 ? 0.65 : aspect > 2.6 ? 0.88 : 1);
            if (!best || score > best.score) best = { ...rect, angle, area, score };
          }
        }
      }
    }
  }
  return best;
}

function splitHalls(zone, width, height) {
  const zoneWidth = Math.max(zone.maxX - zone.minX, 0);
  const zoneHeight = Math.max(zone.maxY - zone.minY, 0);
  if (zoneWidth < 45 || zoneHeight < 45) return [];
  const cols = zoneWidth > 520 ? 3 : zoneWidth > 220 ? 2 : 1;
  const rows = zoneHeight > 360 ? 2 : 1;
  const minPadDimension = Math.min(width, height);
  const gap = clampAvailable(minPadDimension * 0.025, Math.min(8, minPadDimension * 0.025), Math.min(24, minPadDimension * 0.06));
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
  return halls.slice(0, 6);
}

function createProjection(points) {
  const origin = {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
  const cosLat = Math.cos((origin.lat * Math.PI) / 180);
  const feetPerDegreeLat = 111132 * 3.280839895;
  const feetPerDegreeLng = 111320 * cosLat * 3.280839895;
  return {
    toXY(point) {
      return { x: (point.lng - origin.lng) * feetPerDegreeLng, y: (point.lat - origin.lat) * feetPerDegreeLat };
    },
    toLatLng(point) {
      return { lat: Number((origin.lat + point.y / feetPerDegreeLat).toFixed(7)), lng: Number((origin.lng + point.x / feetPerDegreeLng).toFixed(7)) };
    },
  };
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

function rectPoints(rect) {
  return [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
}

function grid(min, max, steps) {
  return Array.from({ length: steps + 1 }, (_, index) => min + ((max - min) * index) / steps);
}

function rotate(point, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function signedRingArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.lng * next.lat - next.lng * current.lat;
  }
  return sum / 2;
}

function orientHoleOppositeBoundary(outer, hole) {
  if (Math.sign(signedRingArea(outer)) === Math.sign(signedRingArea(hole))) return [...hole].reverse();
  return hole;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampAvailable(value, min, max) {
  return max < min ? Math.max(0, max) : clamp(value, min, max);
}

function setKeyState(className, text) {
  keyStatus.className = `key-status ${className}`;
  keyStatus.querySelector("strong").textContent = text;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

loadGoogleMaps();
