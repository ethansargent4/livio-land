const keyStatus = document.getElementById("keyStatus");
const blocker = document.getElementById("mapBlocker");
const mapEl = document.getElementById("googleMap");
const saveCutoutButton = document.querySelector("[data-action='save-exclusion']");
const apiKeyInput = document.getElementById("apiKeyInput");
const connectKeyButton = document.getElementById("connectKeyButton");
const pasteKeyButton = document.getElementById("pasteKeyButton");
const saveLayoutButton = document.getElementById("saveLayoutButton");
const refreshLayoutsButton = document.getElementById("refreshLayoutsButton");
const savedLayoutsList = document.getElementById("savedLayoutsList");
const saveStatus = document.getElementById("saveStatus");
const buildingInputs = {
  firstWidthFt: document.getElementById("firstWidthFt"),
  additionalWidthFt: document.getElementById("additionalWidthFt"),
  connectedBuildings: document.getElementById("connectedBuildings"),
  buildingLengthFt: document.getElementById("buildingLengthFt"),
  rows: document.getElementById("buildingRows"),
  rowGapFt: document.getElementById("rowGapFt"),
};
const LOCAL_KEY = "livio-grid-google-maps-api-key";
const FEET_PER_METER = 3.280839895;
const DEFAULT_BUILDING_CONFIG = {
  firstWidthFt: metersToFeet(10),
  additionalWidthFt: metersToFeet(9),
  connectedBuildings: 3,
  buildingLengthFt: 320,
  rows: 10,
  rowGapFt: 30,
};
const FIT_SCENARIOS = {
  balanced: {
    label: "Balanced",
    description: "Balanced continuous rows with room for truck and utility access.",
    driveRatio: 0.12,
    yardRatio: 0.18,
    gapRatio: 0.025,
    maxHalls: 24,
    mwPerHallAcre: 18,
    scoreBoost: 1,
  },
  dense: {
    label: "High density",
    description: "Prioritizes maximum data hall yield while keeping clear of cutouts.",
    driveRatio: 0.09,
    yardRatio: 0.13,
    gapRatio: 0.018,
    maxHalls: 36,
    mwPerHallAcre: 22,
    scoreBoost: 1.12,
  },
  resilient: {
    label: "Resilient",
    description: "Conservative continuous rows with larger service and access reserves.",
    driveRatio: 0.16,
    yardRatio: 0.24,
    gapRatio: 0.035,
    maxHalls: 18,
    mwPerHallAcre: 14,
    scoreBoost: 0.92,
  },
};

let mode = "boundary";
let map;
let parcelPolygon;
let draftPolyline;
let draftPolygon;
let markers = [];
let layoutPolygons = [];
let optimizedLayout = null;
let activeScenario = "balanced";
let isDraggingMarker = false;
let buildingConfig = { ...DEFAULT_BUILDING_CONFIG };
let savedLayouts = [];
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
  optimizedLayout = optimizeLatLng(boundary, exclusions, FIT_SCENARIOS[activeScenario], buildingConfig);
  render();
});

document.querySelectorAll("[data-scenario]").forEach((button) => {
  button.addEventListener("click", () => {
    activeScenario = button.dataset.scenario;
    document.querySelectorAll("[data-scenario]").forEach((item) => item.classList.toggle("active", item === button));
    optimizedLayout = boundary.length >= 3 ? optimizeLatLng(boundary, exclusions, FIT_SCENARIOS[activeScenario], buildingConfig) : null;
    render();
  });
});

Object.values(buildingInputs).forEach((input) => {
  input.addEventListener("input", () => {
    buildingConfig = getBuildingConfig();
    if (optimizedLayout && boundary.length >= 3) {
      optimizedLayout = optimizeLatLng(boundary, exclusions, FIT_SCENARIOS[activeScenario], buildingConfig);
      render();
      return;
    }
    writeMetrics();
  });
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
saveLayoutButton.addEventListener("click", () => saveCurrentLayout());
refreshLayoutsButton.addEventListener("click", () => loadSavedLayouts());

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
  const serverKey = (window.LIVIO_GOOGLE_MAPS_API_KEY || "").trim();
  if (serverKey) {
    localStorage.removeItem(LOCAL_KEY);
    return serverKey;
  }
  return (localStorage.getItem(LOCAL_KEY) || "").trim();
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
    if (isDraggingMarker) return;
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
  const paths = currentParcelPaths();

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
  addEdgeMarkers(boundary, "#7dd3fc", (insertIndex, point) => boundary.splice(insertIndex, 0, point), true);
  exclusions.forEach((path, pathIndex) => path.forEach((point, index) => {
    addMarker(point, index, "#ef4444", (next) => path[index] = next, () => {
      exclusions[pathIndex].splice(index, 1);
      exclusions = exclusions.filter((item) => item.length >= 3);
    });
  }));
  exclusions.forEach((path, pathIndex) => addEdgeMarkers(path, "#fca5a5", (insertIndex, point) => exclusions[pathIndex].splice(insertIndex, 0, point), true));
  draftExclusion.forEach((point, index) => addMarker(point, index, "#f97316", (next) => draftExclusion[index] = next, () => draftExclusion.splice(index, 1)));
  addEdgeMarkers(draftExclusion, "#fdba74", (insertIndex, point) => draftExclusion.splice(insertIndex, 0, point), false);
  writeMetrics();
}

function getBuildingConfig() {
  return {
    firstWidthFt: metersToFeet(readPositiveNumber(buildingInputs.firstWidthFt, feetToMeters(DEFAULT_BUILDING_CONFIG.firstWidthFt))),
    additionalWidthFt: metersToFeet(readNonNegativeNumber(buildingInputs.additionalWidthFt, feetToMeters(DEFAULT_BUILDING_CONFIG.additionalWidthFt))),
    connectedBuildings: readPositiveInteger(buildingInputs.connectedBuildings, DEFAULT_BUILDING_CONFIG.connectedBuildings),
    buildingLengthFt: readPositiveNumber(buildingInputs.buildingLengthFt, DEFAULT_BUILDING_CONFIG.buildingLengthFt),
    rows: readPositiveInteger(buildingInputs.rows, DEFAULT_BUILDING_CONFIG.rows),
    rowGapFt: readNonNegativeNumber(buildingInputs.rowGapFt, DEFAULT_BUILDING_CONFIG.rowGapFt),
  };
}

function applyBuildingInputs() {
  buildingInputs.firstWidthFt.value = formatMeterInput(feetToMeters(buildingConfig.firstWidthFt));
  buildingInputs.additionalWidthFt.value = formatMeterInput(feetToMeters(buildingConfig.additionalWidthFt));
  buildingInputs.connectedBuildings.value = String(buildingConfig.connectedBuildings);
  buildingInputs.buildingLengthFt.value = String(buildingConfig.buildingLengthFt);
  buildingInputs.rows.value = String(buildingConfig.rows);
  buildingInputs.rowGapFt.value = String(buildingConfig.rowGapFt);
}

function connectedBuildingWidth(config = buildingConfig) {
  return config.firstWidthFt + Math.max(0, config.connectedBuildings - 1) * config.additionalWidthFt;
}

function clusterWidth(count, config = buildingConfig) {
  return config.firstWidthFt + Math.max(0, count - 1) * config.additionalWidthFt;
}

function readPositiveNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function readPositiveInteger(input, fallback) {
  return Math.max(1, Math.round(readPositiveNumber(input, fallback)));
}

function metersToFeet(meters) {
  return meters * FEET_PER_METER;
}

function feetToMeters(feet) {
  return feet / FEET_PER_METER;
}

function formatMeterInput(value) {
  return Number(value.toFixed(1)).toString();
}

function formatMeterRange(minFeet, maxFeet) {
  const minMeters = Math.round(feetToMeters(minFeet));
  const maxMeters = Math.round(feetToMeters(maxFeet));
  return `${minMeters}${minMeters === maxMeters ? "" : `-${maxMeters}`} m`;
}

function writeBuildingMetrics(layout = optimizedLayout) {
  const config = layout?.buildingConfig || buildingConfig;
  const rows = layout?.actualRows || Math.min(config.rows, FIT_SCENARIOS[activeScenario].maxHalls);
  const clusterCounts = layout?.clusterCounts || distributeClusterCounts(rows, config.connectedBuildings, FIT_SCENARIOS[activeScenario].maxHalls);
  const clusterWidths = layout?.clusterWidthsFt || clusterCounts.map((count) => clusterWidth(count, config));
  const rowLengths = layout?.rowLengthsFt || Array.from({ length: rows }, () => config.buildingLengthFt);
  const minWidth = Math.min(...clusterWidths);
  const maxWidth = Math.max(...clusterWidths);
  const minLength = Math.min(...rowLengths);
  const maxLength = Math.max(...rowLengths);
  const clusterText = summarizeRowCounts(clusterCounts);
  setText("buildingFormula", `${rows} row${rows === 1 ? "" : "s"}: ${clusterText}`);
  setText("buildingWidthMetric", formatMeterRange(minWidth, maxWidth));
  setText("buildingLengthMetric", `${Math.round(minLength)}${Math.round(minLength) === Math.round(maxLength) ? "" : `-${Math.round(maxLength)}`} ft`);
  setText("buildingRowsMetric", rows);
}

function summarizeRowCounts(counts) {
  if (counts.length <= 6) return counts.join(" / ");
  return `${counts.slice(0, 3).join(" / ")} / ... / ${counts.slice(-2).join(" / ")}`;
}

function buildLayoutPayload() {
  const gross = areaAcres(boundary);
  const excluded = exclusions.reduce((sum, path) => sum + areaAcres(path), 0);
  const net = Math.max(gross - excluded, 0);
  const savedAt = new Date().toISOString();
  return {
    name: `Livio build ${new Date(savedAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}`,
    savedAt,
    boundary,
    exclusions,
    grossAcres: Number(gross.toFixed(2)),
    excludedAcres: Number(excluded.toFixed(2)),
    netAcres: Number(net.toFixed(2)),
    activeScenario,
    buildingConfig,
    optimizedLayout,
  };
}

async function saveCurrentLayout() {
  if (boundary.length < 3) {
    setSaveStatus("Add at least 3 boundary dots before saving.");
    return;
  }
  if (!optimizedLayout) {
    optimizedLayout = optimizeLatLng(boundary, exclusions, FIT_SCENARIOS[activeScenario], buildingConfig);
    render();
  }

  setSaveStatus("Saving...");
  saveLayoutButton.disabled = true;
  try {
    const response = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildLayoutPayload()),
    });
    if (!response.ok) throw new Error(`Save failed (${response.status})`);
    const data = await response.json();
    const layout = data.layout;
    savedLayouts = [layout, ...savedLayouts.filter((item) => item.id !== layout.id)].slice(0, 25);
    renderSavedLayouts(data.store);
    setSaveStatus(`Saved to ${data.store === "postgres" ? "Railway database" : "local database"}.`);
  } catch (error) {
    setSaveStatus(error.message || "Save failed.");
  } finally {
    saveLayoutButton.disabled = false;
  }
}

async function loadSavedLayouts() {
  try {
    const response = await fetch("/api/layouts", { cache: "no-store" });
    if (!response.ok) throw new Error(`Load failed (${response.status})`);
    const data = await response.json();
    savedLayouts = Array.isArray(data.layouts) ? data.layouts : [];
    renderSavedLayouts(data.store);
  } catch (error) {
    savedLayoutsList.textContent = error.message || "Could not load saved builds.";
  }
}

function renderSavedLayouts(store = "local") {
  savedLayoutsList.textContent = "";
  if (!savedLayouts.length) {
    savedLayoutsList.textContent = `No saved builds yet (${store}).`;
    return;
  }

  savedLayouts.forEach((layout) => {
    const payload = layout.payload || layout;
    const button = document.createElement("button");
    button.className = "saved-layout-item";
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = layout.name || payload.name || "Saved Livio build";
    const meta = document.createElement("span");
    meta.textContent = `${formatAcres(payload.netAcres)} usable | ${formatDate(layout.updatedAt || payload.savedAt)}`;
    button.append(title, meta);
    button.addEventListener("click", () => applySavedLayout(payload));
    savedLayoutsList.append(button);
  });
}

function applySavedLayout(payload) {
  boundary = normalizePaths([payload.boundary])[0] || boundary;
  exclusions = normalizePaths(payload.exclusions);
  activeScenario = FIT_SCENARIOS[payload.activeScenario] ? payload.activeScenario : "balanced";
  buildingConfig = { ...DEFAULT_BUILDING_CONFIG, ...(payload.buildingConfig || {}) };
  applyBuildingInputs();
  document.querySelectorAll("[data-scenario]").forEach((item) => item.classList.toggle("active", item.dataset.scenario === activeScenario));
  optimizedLayout = boundary.length >= 3 ? optimizeLatLng(boundary, exclusions, FIT_SCENARIOS[activeScenario], buildingConfig) : null;
  mode = "boundary";
  document.querySelectorAll("[data-mode]").forEach((item) => item.classList.toggle("active", item.dataset.mode === "boundary"));
  render();
  fitBoundary();
  setSaveStatus("Loaded saved build.");
}

function normalizePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return paths
    .map((path) => Array.isArray(path) ? path.filter(isLatLngPoint).map((point) => ({
      lat: Number(point.lat),
      lng: Number(point.lng),
    })) : [])
    .filter((path) => path.length >= 3);
}

function isLatLngPoint(point) {
  return point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng));
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "saved" : date.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" });
}

function formatAcres(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} ac` : "-- ac";
}

function setSaveStatus(text) {
  saveStatus.textContent = text;
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
  marker.addListener("dragstart", () => {
    isDraggingMarker = true;
    optimizedLayout = null;
    clearLayoutPolygons();
  });
  marker.addListener("drag", (event) => {
    if (event.latLng) {
      onDrag(normalize(event.latLng));
      optimizedLayout = null;
      refreshShapeOverlays();
      writeMetrics();
    }
  });
  marker.addListener("dragend", (event) => {
    if (event.latLng) {
      onDrag(normalize(event.latLng));
      optimizedLayout = null;
      render();
    }
    window.setTimeout(() => {
      isDraggingMarker = false;
    }, 0);
  });
  marker.addListener("dblclick", () => {
    onRemove();
    optimizedLayout = null;
    render();
  });
  markers.push(marker);
}

function addEdgeMarkers(path, color, onInsert, closed) {
  const edgeCount = closed ? path.length : Math.max(0, path.length - 1);
  if (path.length < 2 || edgeCount < 1) return;

  for (let index = 0; index < edgeCount; index++) {
    const nextIndex = (index + 1) % path.length;
    const insertIndex = index + 1;
    let insertedIndex = null;
    const marker = new google.maps.Marker({
      map,
      position: midpoint(path[index], path[nextIndex]),
      draggable: true,
      title: "Add shape point",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 5,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
    });

    const insertPoint = (point) => {
      if (insertedIndex !== null) return insertedIndex;
      onInsert(insertIndex, point);
      insertedIndex = insertIndex;
      return insertedIndex;
    };

    marker.addListener("click", () => {
      insertPoint(normalizePosition(marker.getPosition()));
      optimizedLayout = null;
      render();
    });
    marker.addListener("dragstart", () => {
      isDraggingMarker = true;
      insertPoint(normalizePosition(marker.getPosition()));
      optimizedLayout = null;
      clearLayoutPolygons();
      refreshShapeOverlays();
      writeMetrics();
    });
    marker.addListener("drag", (event) => {
      if (event.latLng && insertedIndex !== null) {
        path[insertedIndex] = normalize(event.latLng);
        optimizedLayout = null;
        refreshShapeOverlays();
        writeMetrics();
      }
    });
    marker.addListener("dragend", (event) => {
      if (event.latLng && insertedIndex !== null) {
        path[insertedIndex] = normalize(event.latLng);
        optimizedLayout = null;
        render();
      }
      window.setTimeout(() => {
        isDraggingMarker = false;
      }, 0);
    });
    markers.push(marker);
  }
}

function drawLayout() {
  if (!optimizedLayout) return;
  const buildingPolygons = optimizedLayout.buildings?.length ? optimizedLayout.buildings : optimizedLayout.halls;
  buildingPolygons.forEach((building) => addLayoutPolygon(building, "#374151", "#9ca3af", 0.78));
}

function currentParcelPaths() {
  return [
    boundary,
    ...exclusions.map((path) => orientHoleOppositeBoundary(boundary, path)),
  ].filter((path) => path.length >= 3);
}

function refreshShapeOverlays() {
  if (parcelPolygon) parcelPolygon.setPaths(currentParcelPaths());
  if (draftPolyline) draftPolyline.setPath(draftExclusion);
  if (draftPolygon) draftPolygon.setPath(draftExclusion);
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
  clearLayoutPolygons();
  markers = [];
  parcelPolygon = null;
  draftPolyline = null;
  draftPolygon = null;
}

function clearLayoutPolygons() {
  layoutPolygons.forEach((polygon) => polygon.setMap(null));
  layoutPolygons = [];
}

function writeMetrics() {
  const gross = areaAcres(boundary);
  const excluded = exclusions.reduce((sum, path) => sum + areaAcres(path), 0);
  const net = Math.max(gross - excluded, 0);
  writeBuildingMetrics();
  setText("dotCount", boundary.length);
  setText("grossArea", `${gross.toFixed(1)} ac`);
  setText("excludedArea", `${excluded.toFixed(1)} ac`);
  setText("netArea", `${net.toFixed(1)} ac`);
  saveCutoutButton.disabled = draftExclusion.length < 3;

  if (optimizedLayout) {
    setText("padArea", `${optimizedLayout.padAcres.toFixed(1)} ac`);
    setText("hallCount", optimizedLayout.totalBuildings || optimizedLayout.halls.length);
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
        : map
          ? `Click Optimize layout to run the ${FIT_SCENARIOS[activeScenario].label} test fit.`
          : "Waiting for a valid Google Maps API key."
    );
  }

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

function normalizePosition(latLng) {
  return {
    lat: Number(latLng.lat().toFixed(7)),
    lng: Number(latLng.lng().toFixed(7)),
  };
}

function midpoint(start, end) {
  return {
    lat: Number(((start.lat + end.lat) / 2).toFixed(7)),
    lng: Number(((start.lng + end.lng) / 2).toFixed(7)),
  };
}

function optimizeLatLng(poly, holes, scenario = FIT_SCENARIOS.balanced, config = buildingConfig) {
  if (poly.length < 3) return null;
  const projection = createProjection(poly);
  const xyBoundary = poly.map(projection.toXY);
  const xyHoles = holes.map((path) => path.map(projection.toXY));
  const best = findBestLayoutPlan(xyBoundary, xyHoles, scenario, config);
  if (!best) return null;

  const toLatLngRect = (rect) => rectPoints(rect).map((point) => projection.toLatLng(rotate(point, best.angle)));
  const hallPlan = best.hallPlan;
  const hallRects = hallPlan.halls;
  if (!hallRects.length) return null;
  const buildingRects = hallPlan.buildings;
  const hallAcres = hallRects.reduce((sum, rect) => sum + ((rect.maxX - rect.minX) * (rect.maxY - rect.minY)) / 43560, 0);
  const layoutEnvelope = getRectBounds(hallRects);
  const padAcres = ((layoutEnvelope.maxX - layoutEnvelope.minX) * (layoutEnvelope.maxY - layoutEnvelope.minY)) / 43560;
  const padUtilization = padAcres ? Math.round((hallAcres / padAcres) * 100) : 0;
  const estimatedMw = Math.round(hallAcres * scenario.mwPerHallAcre);
  const fitScore = Math.max(0, Math.min(100, Math.round((padUtilization * 0.7) + (Math.min(estimatedMw, 180) / 180) * 30)));

  return {
    scenario: { id: activeScenario, label: scenario.label, description: scenario.description },
    pad: toLatLngRect(layoutEnvelope),
    drive: [],
    yard: [],
    halls: hallRects.map(toLatLngRect),
    buildings: buildingRects.map(toLatLngRect),
    buildingConfig: { ...config },
    connectedWidthFt: Math.round(hallPlan.connectedWidthFt),
    clusterCounts: hallPlan.clusterCounts,
    clusterWidthsFt: hallPlan.clusterWidthsFt.map(Math.round),
    minClusterWidthFt: Math.round(Math.min(...hallPlan.clusterWidthsFt)),
    maxClusterWidthFt: Math.round(Math.max(...hallPlan.clusterWidthsFt)),
    rowLengthsFt: hallPlan.rowLengthsFt.map(Math.round),
    buildingLengthFt: Math.round(Math.max(...hallPlan.rowLengthsFt)),
    minBuildingLengthFt: Math.round(Math.min(...hallPlan.rowLengthsFt)),
    maxBuildingLengthFt: Math.round(Math.max(...hallPlan.rowLengthsFt)),
    requestedConnectedBuildings: config.connectedBuildings,
    actualConnectedBuildings: hallPlan.actualConnectedBuildings,
    requestedRows: config.rows,
    actualRows: hallPlan.actualRows,
    rowGapFt: hallPlan.rowGapFt,
    totalBuildings: hallPlan.clusterCounts.reduce((sum, count) => sum + count, 0),
    hallAcres,
    padAcres,
    padUtilization,
    estimatedMw,
    fitScore,
    angleDegrees: (best.angle * 180) / Math.PI,
  };
}

function findBestLayoutPlan(boundaryXY, holesXY, scenario = FIT_SCENARIOS.balanced, config = buildingConfig) {
  let best = null;
  for (let deg = 0; deg < 180; deg += 10) {
    const angle = (deg * Math.PI) / 180;
    const rotatedBoundary = boundaryXY.map((point) => rotate(point, -angle));
    const rotatedHoles = holesXY.map((path) => path.map((point) => rotate(point, -angle)));
    const siteBounds = getBounds(rotatedBoundary);
    const siteWidth = siteBounds.maxX - siteBounds.minX;
    const siteHeight = siteBounds.maxY - siteBounds.minY;
    const edgeSetback = clampAvailable(Math.min(siteWidth, siteHeight) * scenario.gapRatio, 15, 60);
    const zone = {
      minX: siteBounds.minX + edgeSetback,
      maxX: siteBounds.maxX - edgeSetback,
      minY: siteBounds.minY + edgeSetback,
      maxY: siteBounds.maxY - edgeSetback,
    };
    const hallPlan = splitHalls(zone, siteWidth, siteHeight, scenario, config, { boundary: rotatedBoundary, holes: rotatedHoles });
    if (!hallPlan.halls.length) continue;
    const hallArea = hallPlan.halls.reduce((sum, rect) => sum + ((rect.maxX - rect.minX) * (rect.maxY - rect.minY)), 0);
    const targetRows = Math.max(1, Math.min(config.rows, scenario.maxHalls));
    const targetBuildings = Math.max(1, Math.min(scenario.maxHalls, config.rows * config.connectedBuildings));
    const buildingFit = hallPlan.totalBuildings / targetBuildings;
    const averageLength = hallPlan.rowLengthsFt.reduce((sum, value) => sum + value, 0) / hallPlan.rowLengthsFt.length;
    const lengthFit = averageLength / Math.max(1, config.buildingLengthFt);
    const compactRowBonus = Math.max(0, targetRows - hallPlan.actualRows) / targetRows;
    const score = hallArea * (1 + buildingFit * 0.3 + lengthFit * 0.08 + compactRowBonus * 0.06) * scenario.scoreBoost;
    if (!best || score > best.score) {
      best = { angle, hallPlan, score };
    }
  }
  return best;
}

function findBestRect(boundaryXY, holesXY, scenario = FIT_SCENARIOS.balanced) {
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
            const score = area * (aspect > 5 ? 0.35 : aspect > 3.5 ? 0.65 : aspect > 2.6 ? 0.88 : 1) * scenario.scoreBoost;
            if (!best || score > best.score) best = { ...rect, angle, area, score };
          }
        }
      }
    }
  }
  return best;
}

function splitHalls(zone, width, height, scenario = FIT_SCENARIOS.balanced, config = buildingConfig, clearance = null) {
  const zoneWidth = Math.max(zone.maxX - zone.minX, 0);
  const zoneHeight = Math.max(zone.maxY - zone.minY, 0);
  const emptyPlan = {
    halls: [],
    buildings: [],
    actualRows: 0,
    actualConnectedBuildings: 0,
    connectedWidthFt: 0,
    buildingLengthFt: config.buildingLengthFt,
    rowGapFt: config.rowGapFt,
    clusterCounts: [],
    clusterWidthsFt: [],
    rowLengthsFt: [],
    totalBuildings: 0,
  };
  if (zoneWidth < 20 || zoneHeight < 20) return emptyPlan;

  const requestedBuildings = Math.max(1, Math.round(config.connectedBuildings));
  const requestedRows = Math.max(1, Math.round(config.rows));
  const firstWidth = clamp(config.firstWidthFt, 1, zoneWidth);
  const additionalWidth = Math.max(0, config.additionalWidthFt);
  const maxBuildingsByWidth = additionalWidth > 0
    ? Math.max(1, Math.floor(Math.max(0, zoneWidth - firstWidth) / additionalWidth) + 1)
    : requestedBuildings;
  const maxConnectedBuildings = Math.max(1, Math.min(requestedBuildings, maxBuildingsByWidth));
  const rowGapFt = Math.max(0, config.rowGapFt);
  const requestedLength = Math.max(1, config.buildingLengthFt);
  const minPartialLength = Math.min(requestedLength, Math.max(80, requestedLength * 0.45));
  const desiredClusterCounts = planClusterRowsByWidth({
    zoneWidth,
    requestedRows,
    maxConnectedBuildings,
    maxTotalBuildings: scenario.maxHalls,
    firstWidth,
    additionalWidth,
    rowGapFt,
  });
  if (!desiredClusterCounts.length) return emptyPlan;
  const totalWidth = desiredClusterCounts.reduce((sum, count) => sum + clusterWidth(count, { firstWidthFt: firstWidth, additionalWidthFt: additionalWidth }), 0)
    + rowGapFt * Math.max(0, desiredClusterCounts.length - 1);
  const startX = zone.minX + Math.max(0, (zoneWidth - totalWidth) / 2);
  const halls = [];
  const buildings = [];
  const clusterCounts = [];
  const clusterWidthsFt = [];
  const placedRowLengthsFt = [];
  let cursorX = startX;
  for (let row = 0; row < desiredClusterCounts.length; row++) {
    const desiredCount = desiredClusterCounts[row];
    const plannedRowWidth = clusterWidth(desiredCount, { firstWidthFt: firstWidth, additionalWidthFt: additionalWidth });
    const placement = findRowPlacement({
      zone,
      minX: cursorX,
      rowWidth: plannedRowWidth,
      desiredCount,
      requestedLength,
      minPartialLength,
      clearance,
    });
    if (!placement) {
      cursorX += plannedRowWidth + rowGapFt;
      continue;
    }
    const { rect, count, rowWidth } = placement;
    halls.push({
      ...rect,
    });
    clusterCounts.push(count);
    clusterWidthsFt.push(rowWidth);
    placedRowLengthsFt.push(rect.maxY - rect.minY);
    buildings.push(...splitClusterIntoBuildings({
      startX: rect.minX,
      minY: rect.minY,
      buildingLengthFt: rect.maxY - rect.minY,
      clusterCount: count,
      firstWidth,
      additionalWidth,
      rowWidth,
    }));
    cursorX += rowWidth + rowGapFt;
  }
  if (!halls.length) return emptyPlan;
  return {
    halls,
    buildings,
    actualRows: halls.length,
    actualConnectedBuildings: Math.max(...clusterCounts),
    connectedWidthFt: Math.max(...clusterWidthsFt),
    buildingLengthFt: Math.max(...placedRowLengthsFt),
    rowGapFt,
    clusterCounts,
    clusterWidthsFt,
    rowLengthsFt: placedRowLengthsFt,
    totalBuildings: totalBuildingsForCounts(clusterCounts),
  };
}

function findRowPlacement({ zone, minX, rowWidth, desiredCount, requestedLength, minPartialLength, clearance }) {
  const maxLength = Math.min(requestedLength, Math.max(zone.maxY - zone.minY, 0));
  const lengthStep = Math.max(20, requestedLength / 12);
  const lengths = [];
  for (let length = maxLength; length >= minPartialLength; length -= lengthStep) {
    lengths.push(length);
  }
  if (!lengths.some((length) => Math.abs(length - minPartialLength) < 0.1)) {
    lengths.push(minPartialLength);
  }
  for (const rowLengthFt of lengths) {
    const topLimit = zone.maxY - rowLengthFt;
    if (topLimit < zone.minY) continue;
    const topOptions = grid(zone.minY, topLimit, 44)
      .sort((a, b) => Math.abs((a + rowLengthFt / 2) - centerY(zone)) - Math.abs((b + rowLengthFt / 2) - centerY(zone)));
    for (const minY of topOptions) {
      const rect = { minX, maxX: minX + rowWidth, minY, maxY: minY + rowLengthFt };
      if (!clearance || rectClear(rect, clearance.boundary, clearance.holes)) {
        return { rect, count: desiredCount, rowWidth };
      }
    }
  }
  return null;
}

function centerX(rect) {
  return (rect.minX + rect.maxX) / 2;
}

function centerY(rect) {
  return (rect.minY + rect.maxY) / 2;
}

function planClusterRowsByWidth({ zoneWidth, requestedRows, maxConnectedBuildings, maxTotalBuildings, firstWidth, additionalWidth, rowGapFt }) {
  const maxRows = Math.max(1, Math.min(requestedRows, maxTotalBuildings));
  const targetBuildings = Math.max(1, Math.min(maxTotalBuildings, requestedRows * maxConnectedBuildings));
  for (let buildingTarget = targetBuildings; buildingTarget >= 1; buildingTarget--) {
    const minRows = Math.max(1, Math.ceil(buildingTarget / maxConnectedBuildings));
    for (let rowCount = minRows; rowCount <= maxRows; rowCount++) {
      const counts = distributeClusterCounts(rowCount, maxConnectedBuildings, buildingTarget);
      const width = counts.reduce((sum, count) => sum + clusterWidth(count, { firstWidthFt: firstWidth, additionalWidthFt: additionalWidth }), 0)
        + rowGapFt * Math.max(0, rowCount - 1);
      if (width <= zoneWidth) return counts;
    }
  }
  return [];
}

function totalBuildingsForCounts(counts) {
  return counts.reduce((sum, count) => sum + count, 0);
}

function planRowLengths(zoneHeight, requestedRows, maxLength, rowGap, minPartialLength) {
  const rows = [];
  let usedHeight = 0;
  for (let index = 0; index < requestedRows; index++) {
    const gapBefore = rows.length ? rowGap : 0;
    const remaining = zoneHeight - usedHeight - gapBefore;
    if (remaining < minPartialLength) break;
    const rowLength = Math.min(maxLength, remaining);
    rows.push(rowLength);
    usedHeight += gapBefore + rowLength;
  }
  return rows.length ? rows : [Math.max(1, Math.min(maxLength, zoneHeight))];
}

function splitClusterIntoBuildings({ startX, minY, buildingLengthFt, clusterCount, firstWidth, additionalWidth, rowWidth }) {
  const count = Math.max(1, Math.round(clusterCount));
  if (count === 1) {
    return [{ minX: startX, maxX: startX + rowWidth, minY, maxY: minY + buildingLengthFt }];
  }

  const fallbackWidth = rowWidth / count;
  const widths = Array.from({ length: count }, (_, index) => {
    if (index === 0) return Math.max(1, Math.min(firstWidth, rowWidth));
    return additionalWidth > 0 ? additionalWidth : fallbackWidth;
  });
  const totalWidth = widths.reduce((sum, value) => sum + value, 0);
  const scale = totalWidth > 0 ? rowWidth / totalWidth : 1;
  let cursor = startX;
  return widths.map((width) => {
    const scaledWidth = width * scale;
    const rect = {
      minX: cursor,
      maxX: cursor + scaledWidth,
      minY,
      maxY: minY + buildingLengthFt,
    };
    cursor += scaledWidth;
    return rect;
  });
}

function distributeClusterCounts(rowCount, maxConnectedBuildings, maxTotalBuildings) {
  const rows = Array.from({ length: rowCount }, () => 1);
  let remaining = Math.max(0, Math.min(maxTotalBuildings, rowCount * maxConnectedBuildings) - rowCount);
  const fillOrder = rows
    .map((_, index) => index)
    .sort((a, b) => Math.abs(a - (rowCount - 1) / 2) - Math.abs(b - (rowCount - 1) / 2));

  for (const rowIndex of fillOrder) {
    while (remaining > 0 && rows[rowIndex] < maxConnectedBuildings) {
      rows[rowIndex] += 1;
      remaining -= 1;
    }
  }
  return rows;
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

function getRectBounds(rects) {
  return rects.reduce((bounds, rect) => ({
    minX: Math.min(bounds.minX, rect.minX),
    maxX: Math.max(bounds.maxX, rect.maxX),
    minY: Math.min(bounds.minY, rect.minY),
    maxY: Math.max(bounds.maxY, rect.maxY),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
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

applyBuildingInputs();
writeBuildingMetrics();
loadSavedLayouts();
loadGoogleMaps();
