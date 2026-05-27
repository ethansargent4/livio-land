import type { LatLngPoint, OptimizedSiteLayout, ParcelPlot } from './landPlotterTypes'

const SQUARE_METERS_PER_ACRE = 4046.8564224

export function roundCoordinate(value: number): number {
  return Number(value.toFixed(7))
}

export function roundArea(value: number): number {
  return Number(value.toFixed(2))
}

export function normalizePoint(point: google.maps.LatLng | google.maps.LatLngLiteral): LatLngPoint {
  if ('lat' in point && typeof point.lat === 'number') {
    return {
      lat: roundCoordinate(point.lat),
      lng: roundCoordinate(point.lng),
    }
  }

  const latLng = point as google.maps.LatLng
  return {
    lat: roundCoordinate(latLng.lat()),
    lng: roundCoordinate(latLng.lng()),
  }
}

export function pointsToPathLiteral(points: LatLngPoint[]): google.maps.LatLngLiteral[] {
  return points.map((point) => ({ lat: point.lat, lng: point.lng }))
}

export function signedRingArea(points: LatLngPoint[]): number {
  if (points.length < 3) return 0

  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.lng * next.lat - next.lng * current.lat
  }

  return sum / 2
}

export function orientHoleOppositeBoundary(boundary: LatLngPoint[], hole: LatLngPoint[]): LatLngPoint[] {
  const boundaryArea = signedRingArea(boundary)
  const holeArea = signedRingArea(hole)

  if (boundaryArea === 0 || holeArea === 0) return hole
  return Math.sign(boundaryArea) === Math.sign(holeArea) ? [...hole].reverse() : hole
}

export function mvcPathToPoints(path: google.maps.MVCArray<google.maps.LatLng>): LatLngPoint[] {
  return path.getArray().map(normalizePoint)
}

export function polygonAreaAcres(points: LatLngPoint[]): number {
  if (points.length < 3 || !window.google?.maps?.geometry?.spherical) return 0

  const areaSquareMeters = google.maps.geometry.spherical.computeArea(pointsToPathLiteral(points))
  return areaSquareMeters / SQUARE_METERS_PER_ACRE
}

export function buildParcelPlot(
  boundary: LatLngPoint[],
  exclusions: LatLngPoint[][],
  optimizedLayout: OptimizedSiteLayout | null = null
): ParcelPlot {
  const validExclusions = exclusions.filter((path) => path.length >= 3)
  const grossAcres = polygonAreaAcres(boundary)
  const excludedAcres = validExclusions.reduce((total, path) => total + polygonAreaAcres(path), 0)
  const netAcres = Math.max(grossAcres - excludedAcres, 0)

  return {
    boundary,
    exclusions: validExclusions,
    grossAcres: roundArea(grossAcres),
    excludedAcres: roundArea(excludedAcres),
    netAcres: roundArea(netAcres),
    optimizedLayout,
    boundaryEvidence: {
      status: 'user-provided',
      method: 'User-drawn satellite map boundary',
      note: 'Useful for early data center site planning; confirm against survey, assessor GIS, title, easements, wetlands, and utility corridors before reliance.',
      checkedAt: new Date().toISOString(),
    },
  }
}
