export type LatLngPoint = {
  lat: number
  lng: number
}

export type ParcelPlot = {
  boundary: LatLngPoint[]
  exclusions: LatLngPoint[][]
  grossAcres: number
  excludedAcres: number
  netAcres: number
  optimizedLayout?: OptimizedSiteLayout | null
  boundaryEvidence: {
    status: 'user-provided'
    method: 'User-drawn satellite map boundary'
    note: string
    checkedAt: string
  }
}

export type PlotMode = 'boundary' | 'exclusion' | 'pan'

export type LayoutPolygon = {
  label: string
  points: LatLngPoint[]
}

export type OptimizedSiteLayout = {
  buildablePad: LayoutPolygon
  dataHalls: LayoutPolygon[]
  substationYard: LayoutPolygon
  driveAisle: LayoutPolygon
  padAcres: number
  rotationDegrees: number
  confidence: 'high' | 'medium' | 'low'
  notes: string[]
}
