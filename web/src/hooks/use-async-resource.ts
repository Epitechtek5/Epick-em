import { useCallback, useEffect, useState } from 'react'

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown }

// Charge une ressource, annule la requête en cours au changement de dépendances ou au
// démontage, et expose reload() pour l'actualisation manuelle / le « Réessayer ».
export function useAsyncResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
) {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState((current) => (current.status === 'loading' ? current : { status: 'loading' }))
    load(controller.signal).then(
      (data) => {
        if (active) setState({ status: 'success', data })
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', error })
      },
    )
    return () => {
      active = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { state, reload }
}
