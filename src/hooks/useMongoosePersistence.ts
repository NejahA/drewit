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
			try {
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const snapshot = await response.json()
					if (snapshot) {
						store.loadSnapshot(snapshot)
					}
				}
				if (!isCancelled) setLoadingState({ status: 'ready' })
			} catch (err: any) {
				console.error('Error loading snapshot:', err)
				if (!isCancelled) setLoadingState({ status: 'error', error: err.message })
			}
		}

		loadSnapshot()

		return () => {
			isCancelled = true
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		const saveSnapshot = throttle(async () => {
			const snapshot = store.getSnapshot()
			console.log('Persistence: Saving snapshot to MongoDB...')
			try {
				const response = await fetch('/api/drawing', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				})
				if (!response.ok) {
					const errorData = await response.json()
					console.error('Persistence: Save failed:', errorData)
				} else {
					console.log('Persistence: Snapshot saved successfully.')
				}
			} catch (err) {
				console.error('Persistence: Error saving snapshot:', err)
			}
		}, 2000)

		const unsubscribe = store.listen(saveSnapshot, { source: 'user', scope: 'document' })

		return () => {
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
						// More robust comparison to avoid flickering
						if (JSON.stringify(snapshot) !== JSON.stringify(current)) {
							console.log('Persistence: Remote changes detected, loading snapshot...')
							store.loadSnapshot(snapshot)
						}
					}
				}
			} catch (err) {
				console.error('Persistence: Polling error:', err)
			} finally {
				isFetching = false
			}
		}

		const interval = setInterval(pollServer, 3000)

		return () => {
			isCancelled = true
			clearInterval(interval)
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
