import type { FitScenarioId, LatLngPoint, LayoutPolygon, OptimizedSiteLayout } from './landPlotterTypes'

const FEET_PER_METER = 3.280839895
const SQUARE_FEET_PER_ACRE = 43560

type XY = { x: number; y: number }
type Rect = { minX: number; maxX: number; minY: number; maxY: number }
type Candidate = Rect & { angle: number; area: number; score: number }
type ScenarioConfig = {
  id: FitScenarioId
  label: string
  description: string
  driveRatio: number
  yardRatio: number
  gapRatio: number
  maxHalls: number
  mwPerHallAcre: number
  scoreBoost: number
}

const FIT_SCENARIOS: Record<FitScenarioId, ScenarioConfig> = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    description: 'Balanced pad, utility yard, and truck/fire access reserves.',
    driveRatio: 0.12,
    yardRatio: 0.18,
    gapRatio: 0.025,
    maxHalls: 6,
    mwPerHallAcre: 18,
    scoreBoost: 1,
  },
  dense: {
    id: 'dense',
    label: 'High density',
    description: 'Prioritizes maximum data hall yield while keeping clear of cutouts.',
    driveRatio: 0.09,
    yardRatio: 0.13,
    gapRatio: 0.018,
    maxHalls: 8,
    mwPerHallAcre: 22,
    scoreBoost: 1.12,
  },
  resilient: {
    id: 'resilient',
    label: 'Resilient',
    description: 'Larger service, utility, and access reserves for conservative planning.',
    driveRatio: 0.16,
    yardRatio: 0.24,
    gapRatio: 0.035,
    maxHalls: 5,
    mwPerHallAcre: 14,
    scoreBoost: 0.92,
  },
}

export function optimizeSiteLayout(boundary: LatLngPoint[], exclusions: LatLngPoint[][] = [], scenarioId: FitScenarioId = 'balanced'): OptimizedSiteLayout | null {
  if (boundary.length < 3) return null

  const scenario = FIT_SCENARIOS[scenarioId]
  const validExclusions = exclusions.filter((path) => path.length >= 3)
  const projection = createProjection(boundary)
  const boundaryXY = boundary.map(projection.toXY)
  const exclusionsXY = validExclusions.map((path) => path.map(projection.toXY))

  const best = findBestBuildableRect(boundaryXY, exclusionsXY, scenario)
  if (!best) return null

  const rectToLatLng = (rect: Rect): LatLngPoint[] => {
    const corners = [
      { x: rect.minX, y: rect.minY },
      { x: rect.maxX, y: rect.minY },
      { x: rect.maxX, y: rect.maxY },
      { x: rect.minX, y: rect.maxY },
    ].map((point) => rotatePoint(point, best.angle))

    return corners.map(projection.toLatLng)
  }

  const pad: Rect = best
  const padWidth = best.maxX - best.minX
  const padHeight = best.maxY - best.minY
  const minPadDimension = Math.min(padWidth, padHeight)
  const driveDepth = clampAvailable(padHeight * scenario.driveRatio, Math.min(30, padHeight * scenario.driveRatio), padHeight * 0.24)
  const serviceGap = clampAvailable(minPadDimension * scenario.gapRatio, Math.min(10, minPadDimension * scenario.gapRatio), minPadDimension * 0.07)
  const yardWidth = clampAvailable(padWidth * scenario.yardRatio, Math.min(55, padWidth * scenario.yardRatio), padWidth * 0.3)

  const driveAisle = {
    minX: pad.minX,
    maxX: pad.maxX,
    minY: pad.minY,
    maxY: Math.min(pad.maxY, pad.minY + driveDepth),
  }

  const substationYard = {
    minX: Math.max(pad.minX, pad.maxX - yardWidth),
    maxX: pad.maxX,
    minY: driveAisle.maxY,
    maxY: pad.maxY,
  }

  const dataZone = {
    minX: pad.minX + serviceGap,
    maxX: substationYard.minX - serviceGap,
    minY: driveAisle.maxY + serviceGap,
    maxY: pad.maxY - serviceGap,
  }

  const dataHallRects = splitDataHalls(dataZone, padWidth, padHeight, scenario)
  const dataHalls = dataHallRects.map((rect, index) => ({
    label: `Data hall ${index + 1}`,
    points: rectToLatLng(rect),
  }))

  const dataHallAcres = round(dataHallRects.reduce((sum, rect) => sum + rectArea(rect) / SQUARE_FEET_PER_ACRE, 0), 2)
  const padAcres = round((best.area / SQUARE_FEET_PER_ACRE), 2)
  const padUtilization = padAcres ? Math.round((dataHallAcres / padAcres) * 100) : 0
  const estimatedMw = Math.round(dataHallAcres * scenario.mwPerHallAcre)
  const fitScore = Math.max(0, Math.min(100, Math.round((padUtilization * 0.7) + (Math.min(estimatedMw, 180) / 180) * 30)))
  const confidence = best.area > 600000 ? 'high' : best.area > 180000 ? 'medium' : 'low'

  return {
    scenario: {
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
    },
    buildablePad: {
      label: 'Optimized buildable pad',
      points: rectToLatLng(pad),
    },
    dataHalls,
    substationYard: {
      label: 'Substation / utility yard',
      points: rectToLatLng(substationYard),
    },
    driveAisle: {
      label: 'Truck / fire access aisle',
      points: rectToLatLng(driveAisle),
    },
    dataHallAcres,
    padAcres,
    padUtilization,
    estimatedMw,
    fitScore,
    rotationDegrees: round((best.angle * 180) / Math.PI, 1),
    confidence,
    notes: [
      'Preliminary optimization only; verify setbacks, survey, easements, wetlands, floodplain, grading, and utility rights before reliance.',
      'Buildable pad is selected by testing rotated rectangles against the parcel boundary and negative-space exclusions.',
      'Layout reserves a drive/fire access aisle and utility yard before filling the remaining pad with data halls.',
    ],
  }
}

function findBestBuildableRect(boundary: XY[], exclusions: XY[][], scenario: ScenarioConfig): Candidate | null {
  let best: Candidate | null = null
  const angles = Array.from({ length: 18 }, (_, index) => (index * 10 * Math.PI) / 180)

  for (const angle of angles) {
    const rotatedBoundary = boundary.map((point) => rotatePoint(point, -angle))
    const rotatedExclusions = exclusions.map((path) => path.map((point) => rotatePoint(point, -angle)))
    const bounds = getBounds(rotatedBoundary)
    const steps = 26
    const xs = makeGrid(bounds.minX, bounds.maxX, steps)
    const ys = makeGrid(bounds.minY, bounds.maxY, steps)

    for (let left = 0; left < xs.length - 1; left += 1) {
      for (let right = left + 1; right < xs.length; right += 1) {
        const width = xs[right] - xs[left]
        if (width < 80) continue

        for (let bottom = 0; bottom < ys.length - 1; bottom += 1) {
          for (let top = bottom + 1; top < ys.length; top += 1) {
            const height = ys[top] - ys[bottom]
            if (height < 80) continue

            const rect = { minX: xs[left], maxX: xs[right], minY: ys[bottom], maxY: ys[top] }
            if (!isRectClear(rect, rotatedBoundary, rotatedExclusions)) continue

            const area = width * height
            const aspect = Math.max(width, height) / Math.max(Math.min(width, height), 1)
            const aspectPenalty = aspect > 5 ? 0.35 : aspect > 3.5 ? 0.65 : aspect > 2.6 ? 0.88 : 1
            const score = area * aspectPenalty * scenario.scoreBoost

            if (!best || score > best.score) {
              best = { ...rect, angle, area, score }
            }
          }
        }
      }
    }
  }

  return best
}

function splitDataHalls(zone: Rect, padWidth: number, padHeight: number, scenario: ScenarioConfig): Rect[] {
  const width = Math.max(zone.maxX - zone.minX, 0)
  const height = Math.max(zone.maxY - zone.minY, 0)
  if (width < 45 || height < 45) return []

  const cols = scenario.id === 'dense' ? (width > 640 ? 4 : width > 280 ? 3 : width > 150 ? 2 : 1) : width > 520 ? 3 : width > 220 ? 2 : 1
  const rows = scenario.id === 'dense' ? (height > 420 ? 3 : height > 220 ? 2 : 1) : height > 360 ? 2 : 1
  const minPadDimension = Math.min(padWidth, padHeight)
  const gap = clampAvailable(minPadDimension * scenario.gapRatio, Math.min(8, minPadDimension * scenario.gapRatio), Math.min(24, minPadDimension * 0.06))
  const hallWidth = (width - gap * (cols - 1)) / cols
  const hallHeight = (height - gap * (rows - 1)) / rows
  const halls: Rect[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      halls.push({
        minX: zone.minX + col * (hallWidth + gap),
        maxX: zone.minX + col * (hallWidth + gap) + hallWidth,
        minY: zone.minY + row * (hallHeight + gap),
        maxY: zone.minY + row * (hallHeight + gap) + hallHeight,
      })
    }
  }

  return halls.slice(0, scenario.maxHalls)
}

function rectArea(rect: Rect): number {
  return Math.max(rect.maxX - rect.minX, 0) * Math.max(rect.maxY - rect.minY, 0)
}

function isRectClear(rect: Rect, boundary: XY[], exclusions: XY[][]): boolean {
  const corners = rectCorners(rect)
  const center = { x: (rect.minX + rect.maxX) / 2, y: (rect.minY + rect.maxY) / 2 }

  if (![...corners, center].every((point) => pointInPolygon(point, boundary))) return false
  if (rectIntersectsPolygonBoundary(rect, boundary)) return false
  return exclusions.every((hole) => !rectOverlapsPolygon(rect, hole))
}

function rectCorners(rect: Rect): XY[] {
  return [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ]
}

function rectEdges(rect: Rect): [XY, XY][] {
  const corners = rectCorners(rect)
  return corners.map((point, index) => [point, corners[(index + 1) % corners.length]])
}

function polygonEdges(polygon: XY[]): [XY, XY][] {
  return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]])
}

function rectIntersectsPolygonBoundary(rect: Rect, polygon: XY[]): boolean {
  return rectEdges(rect).some(([rectStart, rectEnd]) =>
    polygonEdges(polygon).some(([polyStart, polyEnd]) => segmentsIntersect(rectStart, rectEnd, polyStart, polyEnd))
  )
}

function rectOverlapsPolygon(rect: Rect, polygon: XY[]): boolean {
  if (polygon.length < 3) return false

  if (rectCorners(rect).some((corner) => pointInPolygon(corner, polygon) || pointOnPolygonBoundary(corner, polygon))) {
    return true
  }

  if (polygon.some((point) => pointInRect(point, rect))) return true
  return rectIntersectsPolygonBoundary(rect, polygon)
}

function pointInRect(point: XY, rect: Rect): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
}

function pointOnPolygonBoundary(point: XY, polygon: XY[]): boolean {
  return polygonEdges(polygon).some(([start, end]) => pointOnSegment(point, start, end))
}

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && pointOnSegment(c, a, b)) return true
  if (o2 === 0 && pointOnSegment(d, a, b)) return true
  if (o3 === 0 && pointOnSegment(a, c, d)) return true
  if (o4 === 0 && pointOnSegment(b, c, d)) return true
  return false
}

function orientation(a: XY, b: XY, c: XY): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) < 1e-9) return 0
  return value > 0 ? 1 : -1
}

function pointOnSegment(point: XY, start: XY, end: XY): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y)
  if (Math.abs(cross) > 1e-9) return false

  return (
    point.x >= Math.min(start.x, end.x) - 1e-9 &&
    point.x <= Math.max(start.x, end.x) + 1e-9 &&
    point.y >= Math.min(start.y, end.y) - 1e-9 &&
    point.y <= Math.max(start.y, end.y) + 1e-9
  )
}

function createProjection(points: LatLngPoint[]) {
  const origin = {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  }
  const cosLat = Math.cos((origin.lat * Math.PI) / 180)
  const feetPerDegreeLat = 111132 * FEET_PER_METER
  const feetPerDegreeLng = 111320 * cosLat * FEET_PER_METER

  return {
    toXY(point: LatLngPoint): XY {
      return {
        x: (point.lng - origin.lng) * feetPerDegreeLng,
        y: (point.lat - origin.lat) * feetPerDegreeLat,
      }
    },
    toLatLng(point: XY): LatLngPoint {
      return {
        lat: round(origin.lat + point.y / feetPerDegreeLat, 7),
        lng: round(origin.lng + point.x / feetPerDegreeLng, 7),
      }
    },
  }
}

function pointInPolygon(point: XY, polygon: XY[]): boolean {
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index]
    const previousPoint = polygon[previous]
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y + Number.EPSILON) +
          currentPoint.x

    if (crosses) inside = !inside
  }
  return inside
}

function getBounds(points: XY[]): Rect {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  )
}

function makeGrid(min: number, max: number, steps: number): number[] {
  return Array.from({ length: steps + 1 }, (_, index) => min + ((max - min) * index) / steps)
}

function rotatePoint(point: XY, angle: number): XY {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampAvailable(value: number, min: number, max: number): number {
  return max < min ? Math.max(0, max) : clamp(value, min, max)
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places
  return Math.round(value * multiplier) / multiplier
}
