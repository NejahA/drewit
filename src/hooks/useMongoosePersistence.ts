import { createTLStore, defaultShapeUtils, throttle } from 'tldraw'
import { useEffect, useState } from 'react'

const DRAWING_ID = 'global-canvas'

export function useMongoosePersistence() {
	const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
	const [loadingState, setLoadingState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({
		status: 'loading',
	})

	useEffect(() => {
		let isCancelled = false

		async function loadSnapshot() {
			console.log('Persistence: Attempting to load initial snapshot...')
			try {
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const snapshot = await response.json()
					if (snapshot) {
						console.log('Persistence: Initial snapshot loaded.')
						store.loadSnapshot(snapshot)
					} else {
						console.log('Persistence: No existing snapshot found on server.')
					}
					if (!isCancelled) setLoadingState({ status: 'ready' })
				} else {
					const errorText = await response.text()
					console.error('Persistence: Failed to load snapshot from server:', response.status, errorText)
					if (!isCancelled) setLoadingState({ status: 'error', error: `Server returned ${response.status}` })
				}
			} catch (err: any) {
				console.error('Persistence: Error during initial load:', err)
				if (!isCancelled) setLoadingState({ status: 'error', error: err.message })
			}
		}

		loadSnapshot()

		return () => {
			isCancelled = true
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready') {
			console.log('Persistence: Not ready yet, status:', loadingState.status)
			return
		}

		console.log('Persistence: Setting up change listener...')

		const saveSnapshot = throttle(async () => {
			const snapshot = store.getSnapshot()
			console.log('Persistence: Throttled save firing. Current snapshot size:', JSON.stringify(snapshot).length)
			try {
				const response = await fetch('/api/drawing', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				})
				if (!response.ok) {
					const errorData = await response.json()
					console.error('Persistence: Save request failed:', errorData)
				} else {
					console.log('Persistence: Save request successful.')
				}
			} catch (err) {
				console.error('Persistence: Network error during save:', err)
			}
		}, 2000)

		const unsubscribe = store.listen((update) => {
			console.log('Persistence: Store update detected from source:', update.source)
			if (update.source === 'user') {
				saveSnapshot()
			}
		}, { scope: 'document' })

		return () => {
			console.log('Persistence: Cleaning up change listener.')
			unsubscribe()
		}
	}, [store, loadingState.status])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		let isCancelled = false
		let isFetching = false

		async function pollServer() {
			if (isFetching) return
			isFetching = true
			try {
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const snapshot = await response.json()
					if (snapshot && !isCancelled) {
						const current = store.getSnapshot()
						if (JSON.stringify(snapshot) !== JSON.stringify(current)) {
							console.log('Persistence: Remote changes detected during polling. Syncing...')
							store.loadSnapshot(snapshot)
						}
					}
				}
			} catch (err) {
				console.error('Persistence: Polling network error:', err)
			} finally {
				isFetching = false
			}
		}

		const interval = setInterval(pollServer, 5000) // Increase interval slightly to reduce noise

		return () => {
			isCancelled = true
			clearInterval(interval)
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
