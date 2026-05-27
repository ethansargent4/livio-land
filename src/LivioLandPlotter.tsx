'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Crosshair, Eraser, Hand, MapPinned, RotateCcw, Scissors, Sparkles, Trash2 } from 'lucide-react'
import { loadGoogleMaps } from './googleMapsLoader'
import type { LatLngPoint, OptimizedSiteLayout, ParcelPlot, PlotMode } from './landPlotterTypes'
import { buildParcelPlot, orientHoleOppositeBoundary, pointsToPathLiteral } from './parcelGeometry'
import { optimizeSiteLayout } from './layoutOptimizer'

type LivioLandPlotterProps = {
  apiKey: string
  mapId?: string
  initialCenter?: LatLngPoint
  initialBoundary?: LatLngPoint[]
  initialExclusions?: LatLngPoint[][]
  onChange?: (plot: ParcelPlot) => void
  className?: string
}

const DEFAULT_CENTER: LatLngPoint = { lat: 39.8283, lng: -98.5795 }
const DEFAULT_ZOOM = 5
const SITE_ZOOM = 17

export default function LivioLandPlotter({
  apiKey,
  mapId,
  initialCenter = DEFAULT_CENTER,
  initialBoundary = [],
  initialExclusions = [],
  onChange,
  className = '',
}: LivioLandPlotterProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const parcelPolygonRef = useRef<google.maps.Polygon | null>(null)
  const draftPolygonRef = useRef<google.maps.Polygon | null>(null)
  const layoutPolygonRefs = useRef<google.maps.Polygon[]>([])
  const markersRef = useRef<google.maps.Marker[]>([])
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null)

  const [loadError, setLoadError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [mode, setMode] = useState<PlotMode>('boundary')
  const [boundary, setBoundary] = useState<LatLngPoint[]>(initialBoundary)
  const [exclusions, setExclusions] = useState<LatLngPoint[][]>(initialExclusions)
  const [draftExclusion, setDraftExclusion] = useState<LatLngPoint[]>([])
  const [optimizedLayout, setOptimizedLayout] = useState<OptimizedSiteLayout | null>(null)

  const parcelPlot = useMemo(() => buildParcelPlot(boundary, exclusions, optimizedLayout), [boundary, exclusions, optimizedLayout])
  const canCreateExclusion = boundary.length >= 3
  const canOptimize = boundary.length >= 3
  const vertexCountLabel = boundary.length === 1 ? '1 dot' : `${boundary.length} dots`

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((marker) => marker.setMap(null))
    markersRef.current = []
  }, [])

  const clearLayoutPolygons = useCallback(() => {
    layoutPolygonRefs.current.forEach((polygon) => polygon.setMap(null))
    layoutPolygonRefs.current = []
  }, [])

  const redrawPolygons = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    const parcelPaths = [
      pointsToPathLiteral(boundary),
      ...exclusions.map((path) => pointsToPathLiteral(orientHoleOppositeBoundary(boundary, path))),
    ].filter((path) => path.length >= 3)

    if (!parcelPolygonRef.current) {
      parcelPolygonRef.current = new google.maps.Polygon({
        map,
        clickable: false,
        editable: false,
        draggable: false,
        strokeColor: '#06adf5',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#06adf5',
        fillOpacity: 0.22,
      })
    }

    parcelPolygonRef.current.setOptions({
      paths: parcelPaths,
      editable: false,
    })

    if (!draftPolygonRef.current) {
      draftPolygonRef.current = new google.maps.Polygon({
        map,
        clickable: false,
        editable: false,
        strokeColor: '#ef4444',
        strokeOpacity: 1,
        strokeWeight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.22,
      })
    }

    draftPolygonRef.current.setPath(pointsToPathLiteral(draftExclusion))
    draftPolygonRef.current.setVisible(draftExclusion.length > 0)
  }, [boundary, draftExclusion, exclusions])

  const redrawMarkers = useCallback(() => {
    const map = mapRef.current
    if (!map) return

    clearMarkers()

    const makeMarker = ({
      point,
      label,
      fillColor,
      onDrag,
      onRemove,
    }: {
      point: LatLngPoint
      label: string
      fillColor: string
      onDrag: (point: LatLngPoint) => void
      onRemove: () => void
    }) => {
      const marker = new google.maps.Marker({
        map,
        position: point,
        draggable: true,
        label: {
          text: label,
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: '700',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
        zIndex: 1000,
      })

      marker.addListener('drag', (event: google.maps.MapMouseEvent) => {
        if (!event.latLng) return
        onDrag({
          lat: Number(event.latLng.lat().toFixed(7)),
          lng: Number(event.latLng.lng().toFixed(7)),
        })
      })

      marker.addListener('dblclick', onRemove)
      markersRef.current.push(marker)
    }

    boundary.forEach((point, index) => {
      makeMarker({
        point,
        label: String(index + 1),
        fillColor: '#06adf5',
        onDrag: (nextPoint) => {
          setBoundary((current) => current.map((item, itemIndex) => (itemIndex === index ? nextPoint : item)))
        },
        onRemove: () => {
          setBoundary((current) => current.filter((_, itemIndex) => itemIndex !== index))
        },
      })
    })

    exclusions.forEach((path, pathIndex) => {
      path.forEach((point, pointIndex) => {
        makeMarker({
          point,
          label: String(pointIndex + 1),
          fillColor: '#ef4444',
          onDrag: (nextPoint) => {
            setExclusions((current) =>
              current.map((exclusion, exclusionIndex) =>
                exclusionIndex === pathIndex
                  ? exclusion.map((item, itemIndex) => (itemIndex === pointIndex ? nextPoint : item))
                  : exclusion
              )
            )
          },
          onRemove: () => {
            setExclusions((current) =>
              current
                .map((exclusion, exclusionIndex) =>
                  exclusionIndex === pathIndex ? exclusion.filter((_, itemIndex) => itemIndex !== pointIndex) : exclusion
                )
                .filter((exclusion) => exclusion.length >= 3)
            )
          },
        })
      })
    })

    draftExclusion.forEach((point, index) => {
      makeMarker({
        point,
        label: String(index + 1),
        fillColor: '#f97316',
        onDrag: (nextPoint) => {
          setDraftExclusion((current) => current.map((item, itemIndex) => (itemIndex === index ? nextPoint : item)))
        },
        onRemove: () => {
          setDraftExclusion((current) => current.filter((_, itemIndex) => itemIndex !== index))
        },
      })
    })
  }, [boundary, clearMarkers, draftExclusion, exclusions])

  const redrawOptimizedLayout = useCallback(() => {
    const map = mapRef.current
    clearLayoutPolygons()
    if (!map || !optimizedLayout) return

    const addLayoutPolygon = ({
      points,
      strokeColor,
      fillColor,
      fillOpacity,
      zIndex,
    }: {
      points: LatLngPoint[]
      strokeColor: string
      fillColor: string
      fillOpacity: number
      zIndex: number
    }) => {
      const polygon = new google.maps.Polygon({
        map,
        paths: pointsToPathLiteral(points),
        clickable: false,
        editable: false,
        draggable: false,
        strokeColor,
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor,
        fillOpacity,
        zIndex,
      })

      layoutPolygonRefs.current.push(polygon)
    }

    addLayoutPolygon({
      points: optimizedLayout.buildablePad.points,
      strokeColor: '#f59e0b',
      fillColor: '#fbbf24',
      fillOpacity: 0.18,
      zIndex: 20,
    })

    addLayoutPolygon({
      points: optimizedLayout.driveAisle.points,
      strokeColor: '#475569',
      fillColor: '#64748b',
      fillOpacity: 0.34,
      zIndex: 30,
    })

    optimizedLayout.dataHalls.forEach((hall) => {
      addLayoutPolygon({
        points: hall.points,
        strokeColor: '#0f6fa8',
        fillColor: '#06adf5',
        fillOpacity: 0.42,
        zIndex: 40,
      })
    })

    addLayoutPolygon({
      points: optimizedLayout.substationYard.points,
      strokeColor: '#047857',
      fillColor: '#10b981',
      fillOpacity: 0.36,
      zIndex: 35,
    })
  }, [clearLayoutPolygons, optimizedLayout])

  useEffect(() => {
    onChange?.(parcelPlot)
  }, [onChange, parcelPlot])

  useEffect(() => {
    let cancelled = false
    setMapReady(false)

    loadGoogleMaps({ apiKey, libraries: ['geometry'] })
      .then(() => {
        if (cancelled || !mapElementRef.current) return

        mapRef.current = new google.maps.Map(mapElementRef.current, {
          center: initialCenter,
          zoom: initialBoundary.length >= 3 ? SITE_ZOOM : DEFAULT_ZOOM,
          mapId,
          mapTypeId: google.maps.MapTypeId.HYBRID,
          clickableIcons: false,
          fullscreenControl: true,
          mapTypeControl: true,
          streetViewControl: false,
          rotateControl: true,
          scaleControl: true,
          gestureHandling: 'greedy',
        })

        setMapReady(true)
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : 'Google Maps failed to load.'))

    return () => {
      cancelled = true
      clickListenerRef.current?.remove()
      clearMarkers()
      clearLayoutPolygons()
      parcelPolygonRef.current?.setMap(null)
      draftPolygonRef.current?.setMap(null)
    }
  }, [apiKey, clearLayoutPolygons, clearMarkers, initialBoundary.length, initialCenter.lat, initialCenter.lng, mapId])

  useEffect(() => {
    if (!mapReady) return
    redrawPolygons()
    redrawMarkers()
    redrawOptimizedLayout()
  }, [mapReady, redrawMarkers, redrawOptimizedLayout, redrawPolygons])

  useEffect(() => {
    clickListenerRef.current?.remove()

    const map = mapRef.current
    if (!map || mode === 'pan') return

    clickListenerRef.current = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return

      const nextPoint = {
        lat: Number(event.latLng.lat().toFixed(7)),
        lng: Number(event.latLng.lng().toFixed(7)),
      }

      if (mode === 'boundary') {
        setBoundary((current) => [...current, nextPoint])
        return
      }

      if (mode === 'exclusion' && canCreateExclusion) {
        setDraftExclusion((current) => [...current, nextPoint])
      }
    })

    return () => clickListenerRef.current?.remove()
  }, [canCreateExclusion, mode])

  const finishExclusion = useCallback(() => {
    if (draftExclusion.length < 3) return
    setExclusions((current) => [...current, draftExclusion])
    setDraftExclusion([])
  }, [draftExclusion])

  const undoLastPoint = useCallback(() => {
    if (mode === 'exclusion' && draftExclusion.length > 0) {
      setDraftExclusion((current) => current.slice(0, -1))
      return
    }

    if (mode === 'boundary') {
      setBoundary((current) => current.slice(0, -1))
    }
  }, [draftExclusion.length, mode])

  const clearAll = useCallback(() => {
    setBoundary([])
    setExclusions([])
    setDraftExclusion([])
    setMode('boundary')
  }, [])

  const removeLastExclusion = useCallback(() => {
    setExclusions((current) => current.slice(0, -1))
  }, [])

  const optimizeLayout = useCallback(() => {
    setOptimizedLayout(optimizeSiteLayout(boundary, exclusions))
  }, [boundary, exclusions])

  const recenter = useCallback(() => {
    mapRef.current?.panTo(initialCenter)
    mapRef.current?.setZoom(SITE_ZOOM)
  }, [initialCenter])

  return (
    <section className={`rounded-2xl border border-slate-200 bg-white overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <MapPinned className="h-5 w-5 text-[#06adf5]" />
            <h2 className="text-base font-bold text-slate-900">Land Boundary Plotter</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Click the map to place numbered dots. Drag dots to refine the parcel. Double-click a dot to remove it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ToolButton active={mode === 'boundary'} onClick={() => setMode('boundary')} icon={<Crosshair className="h-4 w-4" />}>
            Boundary
          </ToolButton>
          <ToolButton
            active={mode === 'exclusion'}
            disabled={!canCreateExclusion}
            onClick={() => setMode('exclusion')}
            icon={<Scissors className="h-4 w-4" />}
          >
            Negative space
          </ToolButton>
          <ToolButton active={mode === 'pan'} onClick={() => setMode('pan')} icon={<Hand className="h-4 w-4" />}>
            Pan
          </ToolButton>
          <ToolButton
            disabled={!canOptimize}
            onClick={optimizeLayout}
            icon={<Sparkles className="h-4 w-4" />}
          >
            Optimize layout
          </ToolButton>
        </div>
      </div>

      <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="relative min-h-[420px] bg-slate-100">
          <div ref={mapElementRef} className="absolute inset-0" />
          {loadError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 p-6 text-center">
              <div>
                <p className="text-sm font-semibold text-slate-900">Map unavailable</p>
                <p className="mt-1 text-sm text-slate-500">{loadError}</p>
              </div>
            </div>
          )}
        </div>

        <aside className="border-t border-slate-100 bg-slate-50/70 p-5 lg:border-l lg:border-t-0">
          <div className="space-y-4">
            <Metric label="Boundary dots" value={vertexCountLabel} />
            <Metric label="Gross land" value={`${parcelPlot.grossAcres} acres`} />
            <Metric label="Negative space" value={`${parcelPlot.excludedAcres} acres`} />
            <Metric label="Net usable land" value={`${parcelPlot.netAcres} acres`} strong />
          </div>

          {optimizedLayout && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-700">Optimized layout</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <MiniMetric label="Pad" value={`${optimizedLayout.padAcres} ac`} />
                <MiniMetric label="Halls" value={String(optimizedLayout.dataHalls.length)} />
                <MiniMetric label="Angle" value={`${optimizedLayout.rotationDegrees}deg`} />
              </div>
              <p className="mt-3 text-xs leading-5 text-amber-900">
                Includes data halls, utility yard, and truck/fire access inside the cleanest buildable pad.
              </p>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <ActionButton onClick={undoLastPoint} icon={<RotateCcw className="h-4 w-4" />}>
              Undo dot
            </ActionButton>
            <ActionButton onClick={recenter} icon={<Crosshair className="h-4 w-4" />}>
              Recenter
            </ActionButton>
            <ActionButton onClick={removeLastExclusion} disabled={exclusions.length === 0} icon={<Eraser className="h-4 w-4" />}>
              Undo cutout
            </ActionButton>
            <ActionButton onClick={clearAll} icon={<Trash2 className="h-4 w-4" />}>
              Clear
            </ActionButton>
          </div>

          {mode === 'exclusion' && (
            <div className="mt-5 rounded-xl border border-red-100 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-900">Negative space mode</p>
              <p className="mt-1 text-xs leading-5 text-red-700">
                Click at least 3 dots inside the parcel for ponds, easements, wetlands, roads, or no-build zones.
              </p>
              <button
                type="button"
                disabled={draftExclusion.length < 3}
                onClick={finishExclusion}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Check className="h-4 w-4" />
                Save negative space
              </button>
            </div>
          )}

          <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Export JSON</p>
            <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
              {JSON.stringify(parcelPlot, null, 2)}
            </pre>
          </div>
        </aside>
      </div>
    </section>
  )
}

function ToolButton({
  active,
  disabled,
  onClick,
  icon,
  children,
}: {
  active?: boolean
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-[#06adf5] bg-[#06adf5] text-white shadow-sm'
          : 'border-slate-200 bg-white text-slate-700 hover:border-[#06adf5]/40 hover:text-[#057fba]'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function ActionButton({
  disabled,
  onClick,
  icon,
  children,
}: {
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      {children}
    </button>
  )
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`mt-1 ${strong ? 'text-2xl font-black text-[#057fba]' : 'text-lg font-bold text-slate-900'}`}>
        {value}
      </p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/80 px-2 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">{label}</p>
      <p className="mt-0.5 text-sm font-black text-slate-900">{value}</p>
    </div>
  )
}
