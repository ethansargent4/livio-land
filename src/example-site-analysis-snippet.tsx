'use client'

import { useState } from 'react'
import LivioLandPlotter from './LivioLandPlotter'
import type { ParcelPlot } from './landPlotterTypes'

export default function SiteAnalysisMapSnippet() {
  const [parcelPlot, setParcelPlot] = useState<ParcelPlot | null>(null)

  async function submitAnalysis() {
    await fetch('/api/analyze-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcelPlot,
      }),
    })
  }

  return (
    <div className="space-y-4">
      <LivioLandPlotter
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAP_ID}
        initialCenter={{ lat: 36.326, lng: -96.965 }}
        onChange={setParcelPlot}
      />

      <button type="button" onClick={submitAnalysis} className="btn-primary">
        Run site analysis
      </button>
    </div>
  )
}

