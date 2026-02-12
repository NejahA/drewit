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
			try {
				await fetch('/api/drawing', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				})
			} catch (err) {
				console.error('Error saving snapshot:', err)
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

		async function pollServer() {
			try {
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const snapshot = await response.json()
					if (snapshot && !isCancelled) {
						// Only load if different to minimize disruption
						const current = store.getSnapshot()
						if (JSON.stringify(snapshot) !== JSON.stringify(current)) {
							store.loadSnapshot(snapshot)
						}
					}
				}
			} catch (err) {
				console.error('Polling error:', err)
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
