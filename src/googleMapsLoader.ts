type GoogleMapsLoaderOptions = {
  apiKey: string
  libraries?: string[]
}

let loaderPromise: Promise<typeof google> | null = null

export function loadGoogleMaps({
  apiKey,
  libraries = ['geometry'],
}: GoogleMapsLoaderOptions): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only load in the browser.'))
  }

  if (!apiKey) {
    return Promise.reject(new Error('Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.'))
  }

  if (window.google?.maps) {
    return Promise.resolve(window.google)
  }

  if (loaderPromise) return loaderPromise

  loaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-livio-google-maps]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google))
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load.')))
      return
    }

    const callbackName = `__livioGoogleMapsLoaded_${Date.now()}`
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      callback: callbackName,
    })

    if (libraries.length) {
      params.set('libraries', libraries.join(','))
    }

    ;(window as any)[callbackName] = () => {
      delete (window as any)[callbackName]
      resolve(window.google)
    }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`
    script.async = true
    script.defer = true
    script.dataset.livioGoogleMaps = 'true'
    script.onerror = () => reject(new Error('Google Maps failed to load.'))
    document.head.appendChild(script)
  })

  return loaderPromise
}

declare global {
  interface Window {
    google: typeof google
  }
}

